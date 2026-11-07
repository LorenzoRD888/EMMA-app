// Scoperta di startup e nuove aziende nel mondo, per tema (es. "polyester film",
// "paper barrier coating"). Senza AI: si interrogano le banche dati di startup
// (Crunchbase, Tracxn, F6S, Dealroom, LinkedIn aziende) e le notizie di round di
// finanziamento, e si ricava il nome dell'azienda dal titolo del risultato.

const norm = s => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
const host = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };

export const DIRECTORIES = [
  { domain: 'crunchbase.com', label: 'Crunchbase', path: /\/organization\//, title: /^(.+?)\s+-\s+Crunchbase/i },
  { domain: 'tracxn.com', label: 'Tracxn', path: /\/d\/companies\//, title: /^(.+?)\s+-\s+(?:\d{4}\s+)?Company Profile/i },
  { domain: 'f6s.com', label: 'F6S', path: /f6s\.com\/(?!.*\b(?:programs|jobs|deals)\b)/, title: /^(.+?)\s*[|-]\s*F6S/i },
  { domain: 'dealroom.co', label: 'Dealroom', path: /\/companies\//, title: /^(.+?)\s*[|-]\s*(?:Dealroom|Company Profile)/i },
  { domain: 'linkedin.com', label: 'LinkedIn', path: /\/company\//, title: /^(.+?)\s*\|\s*LinkedIn/i },
];
const LISTY = /\b(top|best|list|lista|startups|companies|aziende|market|report|ranking|investors|jobs|news|guide|how|what|why)\b/i;
const FUND = /^(.{2,45}?)\s+(?:raises|raised|secures|secured|closes|closed|lands|bags|gets|nabs|announces|completes|receives|raccoglie|chiude|ottiene|lève|sammelt|erhält)\b.{0,80}?(?:€|\$|£|eur|usd|million|milioni|mln|m\b|seed|series|round|funding|finanziament)/i;

function country(text) {
  const t = String(text || '');
  return t.match(/(?:[Bb]ased in|[Hh]eadquartered in|[Ll]ocated in|sede a|con sede (?:a|in)|HQ:?)\s+([A-Z][\w .'-]{2,40}?)(?:[,.;]|\s+and\b|$)/)?.[1]?.trim()
    || t.match(/Headquarters\s*:?\s*([A-Z][\w .,'-]{2,40}?)(?:\s{2}|[;.]|$)/)?.[1]?.trim() || '';
}
function founded(text) { return String(text || '').match(/(?:founded|established|fondata|year founded)\s*(?:in|nel|:)?\s*(20[0-3]\d|19[89]\d)/i)?.[1] || ''; }
const cleanName = n => String(n || '').replace(/\s*[(\[].*$/, '').replace(/\b(company profile|profile|overview)\b.*$/i, '').replace(/[“”"]/g, '').trim();

export function candidateFromResult(r, { topic, via }) {
  const h = host(r.url);
  const dir = DIRECTORIES.find(d => h === d.domain || h.endsWith('.' + d.domain));
  let name = '';
  if (dir) { if (!dir.path.test(r.url)) return null; name = cleanName(r.title?.match(dir.title)?.[1]); }
  else { name = cleanName(r.title?.match(FUND)?.[1]); }
  if (!name || name.length < 2 || name.length > 45 || name.split(/\s+/).length > 5 || LISTY.test(name) || /^\d/.test(name)) return null;
  const text = String(r.summary || '');
  return {
    name, key: norm(name).replace(/[^a-z0-9]+/g, ''), topic,
    description: text.replace(/\s+/g, ' ').slice(0, 400),
    country: country(text), founded: founded(text),
    funding: /seed|series [a-e]|round|raised|raccoglie|funding|€|\$/i.test(r.title + ' ' + text) ? (r.title.match(FUND) ? r.title : '') : '',
    sourceUrl: r.url, source: dir ? dir.label : h, via, publishedAt: r.publishedAt || null,
  };
}

export async function discover(topic, search, { exclude = [] } = {}) {
  const t = String(topic || '').trim().slice(0, 120);
  if (!t) return { candidates: [], errors: ['Enter a topic.'] };
  const skip = new Set(exclude.map(n => norm(n).replace(/[^a-z0-9]+/g, '')));
  const out = new Map(), errors = [];
  const add = c => { if (!c || skip.has(c.key)) return; const prev = out.get(c.key); if (!prev) out.set(c.key, { ...c, sources: [{ source: c.source, url: c.sourceUrl }] }); else if (!prev.sources.some(s => s.url === c.sourceUrl)) { prev.sources.push({ source: c.source, url: c.sourceUrl }); prev.country ||= c.country; prev.founded ||= c.founded; prev.funding ||= c.funding; if (c.description.length > prev.description.length) prev.description = c.description; } };
  for (const d of DIRECTORIES) {
    try { for (const r of await search(`${t} startup`, { topic: 'general', recent: false, maxResults: 20, domain: d.domain })) add(candidateFromResult(r, { topic: t, via: d.label })); }
    catch (e) { errors.push(`${d.label}: ${e.public ? e.message : 'search failed'}`); }
  }
  for (const q of [`${t} startup raises funding`, `${t} startup seed series A round`]) {
    try { for (const r of await search(q, { topic: 'news', recent: false, maxResults: 20 })) add(candidateFromResult(r, { topic: t, via: 'Funding news' })); }
    catch (e) { errors.push(e.public ? e.message : 'News search failed.'); }
  }
  return { candidates: [...out.values()].sort((a, b) => b.sources.length - a.sources.length), errors };
}
