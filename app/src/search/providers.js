// Ricerca web con più servizi intercambiabili. Tutti restituiscono lo stesso
// formato: [{ url, title, summary, publishedAt }]. Si sceglie un servizio
// principale in Impostazioni; se "riserva" è attiva, quando il principale
// fallisce (quota, errore) EMMA prova gli altri configurati.

import { recordSearch } from '../services/research-audit.js';

const fail = (message, status = 502) => Object.assign(new Error(message), { status, public: true });

export const SEARCH_PROVIDERS = {
  tavily: { label: 'Tavily', key: 'TAVILY_API_KEY', site: 'https://tavily.com', note: 'Built for AI agents: clean extracts, news dates. Free monthly plan.' },
  exa: { label: 'Exa', key: 'EXA_API_KEY', site: 'https://exa.ai', note: 'Semantic search: great for technical and specialist content; clean text and publication dates.' },
  jina: { label: 'Jina AI', key: 'JINA_API_KEY', site: 'https://jina.ai', note: 'Returns the full text of the pages found, cleaned. Slower, rich in content.' },
  you: { label: 'You.com', key: 'YOU_API_KEY', site: 'https://you.com/api', note: 'Web and news results with rich extracts and page dates.' },
  brave: { label: 'Brave Search', key: 'BRAVE_API_KEY', site: 'https://brave.com/search/api', note: 'Independent web index, fast, with a news section.' },
  serpapi: { label: 'Google (via SerpApi)', key: 'SERPAPI_API_KEY', site: 'https://serpapi.com', note: 'Google and Google News results. The same key also enables Baidu.' },
};
export const PROVIDER_ORDER = Object.keys(SEARCH_PROVIDERS);
const hasKey = p => !!process.env[SEARCH_PROVIDERS[p]?.key];

export function activeProvider() {
  const pref = process.env.EMMA_SEARCH_PROVIDER;
  if (pref && SEARCH_PROVIDERS[pref] && hasKey(pref)) return pref;
  return PROVIDER_ORDER.find(hasKey) || null;
}
export const searchReady = () => !!activeProvider();
export const activeLabel = () => SEARCH_PROVIDERS[activeProvider()]?.label || null;
export const providerLabel = p => SEARCH_PROVIDERS[p]?.label || p || 'Web search';

const sinceIso = days => new Date(Date.now() - days * 86400000).toISOString();
const freshWord = days => days <= 1 ? 'day' : days <= 7 ? 'week' : days <= 31 ? 'month' : 'year';
const okDate = v => v && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : null;

async function call(fetchFn, url, init, label) {
  let r;
  try { r = await fetchFn(url, { ...init, signal: AbortSignal.timeout(30000) }); } catch { throw fail(`${label} not reachable.`); }
  if (r.status === 401 || r.status === 403) throw fail(`${label}: invalid or unauthorised key.`, 502);
  if (r.status === 429 || r.status === 402) throw fail(`${label}: search limit reached.`, 502);
  if (!r.ok) throw fail(`${label}: search failed (${r.status}).`);
  try { return await r.json(); } catch { throw fail(`${label}: unreadable response.`); }
}

const ADAPTERS = {
  async tavily(q, o, f) {
    const data = await call(f, 'https://api.tavily.com/search', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.TAVILY_API_KEY}` }, body: JSON.stringify({ query: q, topic: o.topic === 'news' ? 'news' : 'general', search_depth: o.advanced ? 'advanced' : 'basic', max_results: Math.min(o.maxResults, 20), ...(o.recent ? { time_range: freshWord(o.days) } : {}), include_answer: false, ...(o.domain ? { include_domains: [o.domain] } : o.exclude?.length ? { exclude_domains: o.exclude } : {}) }) }, 'Tavily');
    return (data.results || []).map(r => ({ url: r.url, title: r.title, summary: r.content, publishedAt: r.published_date || null }));
  },
  async exa(q, o, f) {
    const data = await call(f, 'https://api.exa.ai/search', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.EXA_API_KEY }, body: JSON.stringify({ query: q, numResults: Math.min(o.maxResults, 25), type: 'auto', ...(o.topic === 'news' ? { category: 'news' } : {}), ...(o.domain ? { includeDomains: [o.domain] } : o.exclude?.length ? { excludeDomains: o.exclude } : {}), ...(o.recent ? { startPublishedDate: sinceIso(o.days) } : {}), contents: { text: { maxCharacters: 2000 } } }) }, 'Exa');
    return (data.results || []).map(r => ({ url: r.url, title: r.title || r.url, summary: r.text || (r.highlights || []).join(' ') || r.summary || '', publishedAt: r.publishedDate || null }));
  },
  async jina(q, o, f) {
    const params = new URLSearchParams({ q, num: String(Math.min(o.maxResults, 20)) });
    if (o.domain) params.set('site', o.domain);
    const data = await call(f, 'https://s.jina.ai/?' + params, { headers: { Authorization: `Bearer ${process.env.JINA_API_KEY}`, Accept: 'application/json', 'X-Retain-Images': 'none' } }, 'Jina AI');
    const list = Array.isArray(data.data) ? data.data : Array.isArray(data.results) ? data.results : [];
    return list.map(r => ({ url: r.url, title: r.title || r.url, summary: r.description || String(r.content || '').slice(0, 2500), publishedAt: r.date || r.publishedTime || null }));
  },
  async you(q, o, f) {
    const data = await call(f, 'https://ydc-index.io/v1/search', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-Key': process.env.YOU_API_KEY }, body: JSON.stringify({ query: q, count: Math.min(o.maxResults, 20), ...(o.recent ? { freshness: freshWord(o.days) } : {}), ...(o.domain ? { include_domains: [o.domain] } : o.exclude?.length ? { exclude_domains: o.exclude } : {}) }) }, 'You.com');
    const res = data.results || {};
    return [...(res.news || []), ...(res.web || [])].map(r => ({ url: r.url, title: r.title || r.url, summary: [r.description, ...(r.snippets || [])].filter(Boolean).join(' '), publishedAt: r.page_age || null }));
  },
  async brave(q, o, f) {
    const news = o.topic === 'news';
    const params = new URLSearchParams({ q: (o.domain ? `site:${o.domain} ` : '') + q, count: String(Math.min(o.maxResults, 20)) });
    if (o.recent) params.set('freshness', o.days <= 1 ? 'pd' : o.days <= 7 ? 'pw' : 'pm');
    const data = await call(f, `https://api.search.brave.com/res/v1/${news ? 'news' : 'web'}/search?` + params, { headers: { 'X-Subscription-Token': process.env.BRAVE_API_KEY, Accept: 'application/json' } }, 'Brave Search');
    const list = news ? (data.results || []) : (data.web?.results || []);
    return list.map(r => ({ url: r.url, title: r.title, summary: [r.description, ...(r.extra_snippets || [])].filter(Boolean).join(' ').replace(/<[^>]+>/g, ''), publishedAt: okDate(r.page_age) || null }));
  },
  async serpapi(q, o, f) {
    const news = o.topic === 'news';
    const params = new URLSearchParams({ engine: 'google', q: (o.domain ? `site:${o.domain} ` : '') + q, num: String(Math.min(o.maxResults, 20)), api_key: process.env.SERPAPI_API_KEY, output: 'json' });
    if (news) params.set('tbm', 'nws');
    if (o.recent) params.set('tbs', 'qdr:' + (o.days <= 1 ? 'd' : o.days <= 7 ? 'w' : 'm'));
    const data = await call(f, 'https://serpapi.com/search.json?' + params, {}, 'SerpApi');
    if (data.error) throw fail('SerpApi: ' + String(data.error).slice(0, 120));
    const list = news ? (data.news_results || []) : (data.organic_results || []);
    return list.map(r => ({ url: r.link, title: r.title, summary: r.snippet || '', publishedAt: okDate(r.date) || null }));
  },
};

// Ricerca con il servizio principale ed eventuale riserva.
export async function webSearch(query, { topic = 'general', days = 7, domain, recent = false, maxResults = 10, advanced = false, exclude = [], provider, noFallback = false } = {}, { fetchFn = fetch } = {}) {
  const first = provider && hasKey(provider) ? provider : activeProvider();
  if (!first) throw fail('Set up a web search service in Settings (Tavily, Exa, Jina, You.com, Brave or SerpApi).', 400);
  const order = [first, ...(!noFallback && process.env.EMMA_SEARCH_FALLBACK === '1' ? PROVIDER_ORDER.filter(p => p !== first && hasKey(p)) : [])];
  const opts = { topic, days, domain, recent, maxResults, advanced, exclude };
  let firstError;
  for (const p of order) {
    try {
      const out = (await ADAPTERS[p](query, opts, fetchFn)).filter(r => r.url && /^https?:\/\//.test(r.url)).map(r => ({ ...r, title: String(r.title || '').trim(), summary: String(r.summary || ''), publishedAt: okDate(r.publishedAt), provider: p }));
      recordSearch({ engine: SEARCH_PROVIDERS[p].label, query, results: out.map(r => ({ url: r.url, title: r.title })) });
      return out;
    } catch (e) { firstError ||= e; recordSearch({ engine: SEARCH_PROVIDERS[p].label, query, status: 'error', error: e.public ? e.message : 'Search failed.' }); }
  }
  throw firstError;
}
