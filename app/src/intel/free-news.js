// Free news sources, no API key and no search quota:
//   · Google News RSS  — news in several languages, publication date included
//   · Bing News RSS    — real article addresses, publication date included
//   · GDELT DOC 2.0    — worldwide news archive in 65 languages (gdeltproject.org)
// Each returns [{url, title, summary, publishedAt, source, noRead?}], the same
// shape as the web search services. Errors never stop an update.

const strip = s => String(s || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
const iso = v => { const t = Date.parse(v); return Number.isFinite(t) ? new Date(t).toISOString() : null; };
const tag = (xml, name) => { const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i')); return m ? m[1].replace(/^<!\[CDATA\[|\]\]>$/g, '') : ''; };
const items = xml => [...String(xml).matchAll(/<item\b[\s\S]*?<\/item>/gi)].map(m => m[0]);

async function getText(fetchFn, url) {
  const r = await fetchFn(url, { maxBytes: 3 * 1024 * 1024, signal: AbortSignal.timeout(20000), headers: { Accept: 'application/rss+xml, application/xml, application/json, text/xml, */*', 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) EMMA/3 (market intelligence, local app)', 'Accept-Language': 'en,it;q=0.8' } });
  if (!r.ok) throw Object.assign(Error(`answered ${r.status}`), { public: true });
  return r.text();
}

// Query with alternatives: "A" OR "B" OR "C"
export const orQuery = names => [...new Set(names.filter(Boolean))].slice(0, 6).map(n => `"${String(n).replaceAll('"', '')}"`).join(' OR ');

export const GOOGLE_LANGS = { en: ['en-US', 'US', 'US:en'], it: ['it', 'IT', 'IT:it'], de: ['de', 'DE', 'DE:de'], fr: ['fr', 'FR', 'FR:fr'], es: ['es-419', 'US', 'US:es-419'], zh: ['zh-CN', 'CN', 'CN:zh-Hans'] };

export async function googleNews(query, { days = 7, lang = 'en', fetchFn } = {}) {
  const [hl, gl, ceid] = GOOGLE_LANGS[lang] || GOOGLE_LANGS.en;
  const q = `${query} when:${Math.max(1, Math.min(days, 365))}d`;
  const xml = await getText(fetchFn, `https://news.google.com/rss/search?${new URLSearchParams({ q, hl, gl, ceid })}`);
  return items(xml).map(it => {
    const source = strip(tag(it, 'source'));
    let title = strip(tag(it, 'title'));
    if (source && title.endsWith(' - ' + source)) title = title.slice(0, -(source.length + 3));
    // The link is a Google redirect: it opens the article in the browser, but EMMA does not read it.
    return { url: strip(tag(it, 'link')), title, summary: title, publishedAt: iso(strip(tag(it, 'pubDate'))), source, noRead: true };
  }).filter(r => r.url && r.title);
}

export async function bingNews(query, { days = 7, fetchFn } = {}) {
  const params = new URLSearchParams({ q: query, format: 'rss', setlang: 'en' });
  if (days <= 1) params.set('qft', 'interval="7"'); else if (days <= 7) params.set('qft', 'interval="8"'); else if (days <= 31) params.set('qft', 'interval="9"');
  const xml = await getText(fetchFn, `https://www.bing.com/news/search?${params}`);
  return items(xml).map(it => {
    let url = strip(tag(it, 'link'));
    try { const u = new URL(url); if (/bing\.com$/i.test(u.hostname) && u.searchParams.get('url')) url = u.searchParams.get('url'); } catch {}
    return { url, title: strip(tag(it, 'title')), summary: strip(tag(it, 'description')), publishedAt: iso(strip(tag(it, 'pubDate'))), source: strip(tag(it, 'News:Source')) };
  }).filter(r => /^https?:\/\//.test(r.url) && r.title);
}

// GDELT allows about one request every 5 seconds: wait between calls and retry once when it says "too many requests".
let gdeltLast = 0;
const pause = ms => new Promise(r => setTimeout(r, ms));
export async function gdeltNews(query, { days = 7, maxRecords = 75, fetchFn, gap = Number(process.env.EMMA_GDELT_GAP ?? 6000) } = {}) {
  const wait = gdeltLast + gap - Date.now(); if (wait > 0) await pause(wait);
  const span = days <= 1 ? '24h' : days <= 7 ? '7d' : days <= 31 ? '1m' : '3m';
  const params = new URLSearchParams({ query, mode: 'artlist', format: 'json', maxrecords: String(maxRecords), sort: 'datedesc', timespan: span });
  let text;
  try { gdeltLast = Date.now(); text = await getText(fetchFn, `https://api.gdeltproject.org/api/v2/doc/doc?${params}`); }
  catch (e) { if (!/429/.test(e.message) || !gap) throw e; await pause(gap); gdeltLast = Date.now(); text = await getText(fetchFn, `https://api.gdeltproject.org/api/v2/doc/doc?${params}`); }
  let data; try { data = JSON.parse(text); } catch { throw Object.assign(Error(text.slice(0, 120) || 'unreadable answer'), { public: true }); }
  return (data.articles || []).map(a => {
    const d = String(a.seendate || '').match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
    return { url: a.url, title: strip(a.title), summary: strip(a.title), publishedAt: d ? `${d[1]}-${d[2]}-${d[3]}T${d[4]}:${d[5]}:${d[6]}Z` : null, source: a.domain || '', language: a.language || '' };
  }).filter(r => /^https?:\/\//.test(r.url) && r.title);
}

// Languages to ask Google News for: English always, plus the company's country language, plus Chinese if enabled.
export function newsLanguages(company, { includeChinese = false } = {}) {
  const country = String(company.country || '').toLowerCase();
  const langs = ['en'];
  if (/ital/.test(country)) langs.push('it'); else if (/germ|deuts|austr|swiss|schweiz/.test(country)) langs.push('de'); else if (/fran|belg/.test(country)) langs.push('fr'); else if (/spa|mexic|argent|chile|colomb/.test(country)) langs.push('es');
  const chineseName = (company.aliases || []).some(n => /\p{Script=Han}/u.test(n));
  if ((includeChinese && chineseName) || /china|cina|taiwan|hong kong/.test(country)) langs.push('zh');
  return [...new Set(langs)];
}
