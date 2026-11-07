// Pubblicazioni scientifiche (OpenAlex, gratuito, senza chiave) e brevetti
// (Google Patents tramite Tavily; EPO se configurato). Ogni risultato è
// accettato solo se il nome dell'azienda compare davvero nell'affiliazione
// degli autori o nel titolare del brevetto.

import { namesLikelyMatch, searchEPOPatents } from '../services/patentApis.js';
import { searchReady } from '../search/providers.js';

const norm = s => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
const wordMatch = (text, name) => {
  const t = ' ' + norm(text) + ' ', n = norm(name);
  let i = -1;
  while ((i = t.indexOf(n, i + 1)) !== -1) if (!/[a-z0-9]/.test(t[i - 1] || ' ') && !/[a-z0-9]/.test(t[i + n.length] || ' ')) return true;
  return false;
};

export async function searchPapers(company, { fetchFn = fetch, perPage = 25 } = {}) {
  const names = [company.name, ...(company.aliases || [])].filter(n => n.length >= 4).slice(0, 3);
  const out = new Map();
  for (const name of names) {
    const url = `https://api.openalex.org/works?filter=raw_affiliation_strings.search:${encodeURIComponent(name.replace(/[|,:]/g, ' '))}&sort=publication_date:desc&per_page=${perPage}&select=id,doi,display_name,publication_date,primary_location,authorships,type`;
    const r = await fetchFn(url, { signal: AbortSignal.timeout(20000), headers: { 'User-Agent': 'EMMA-market-intelligence (mailto:emma@localhost)' } });
    if (!r.ok) throw Object.assign(new Error(`OpenAlex not available (${r.status}).`), { public: true });
    const data = await r.json();
    for (const w of data.results || []) {
      const affs = (w.authorships || []).flatMap(a => a.raw_affiliation_strings || []);
      const own = (w.authorships || []).filter(a => (a.raw_affiliation_strings || []).some(s => wordMatch(s, name)));
      if (!own.length) continue; // l'azienda deve comparire nell'affiliazione
      const link = w.doi || w.primary_location?.landing_page_url || w.id;
      out.set(link, {
        kind: 'paper', url: link, title: String(w.display_name || '').slice(0, 500),
        publishedAt: w.publication_date || null,
        venue: w.primary_location?.source?.display_name || w.type || '',
        authors: own.map(a => a.author?.display_name).filter(Boolean).slice(0, 8).join(', '),
        detail: affs.find(s => wordMatch(s, name)) || '',
      });
    }
  }
  return [...out.values()];
}

export async function searchPatents(company, { search, fetchEpo = searchEPOPatents } = {}) {
  const out = new Map();
  const name = company.name;
  if (search && searchReady()) {
    const found = await search(`"${name.replaceAll('"', '')}" patent assignee`, { topic: 'general', recent: false, maxResults: 10, domain: 'patents.google.com' });
    for (const r of found) {
      const text = `${r.title} ${r.summary}`;
      if (!/patents\.google\.com\/patent\//.test(r.url) || !(namesLikelyMatch(text, name) || wordMatch(text, name))) continue;
      const number = r.url.match(/\/patent\/([A-Z]{2}\d+[A-Z]?\d?)/)?.[1] || '';
      const date = text.match(/\b(20\d\d-\d\d-\d\d)\b/)?.[1] || r.publishedAt || null;
      out.set(r.url, { kind: 'patent', url: r.url, title: String(r.title || number).replace(/\s*-\s*Google Patents$/i, '').slice(0, 500), publishedAt: date, venue: number, authors: '', detail: String(r.summary || '').slice(0, 600) });
    }
  }
  try {
    for (const p of await fetchEpo(name, 24)) out.set(p.source_url, { kind: 'patent', url: p.source_url, title: p.title || p.number, publishedAt: p.date ? `${p.date.slice(0, 4)}-${p.date.slice(4, 6)}-${p.date.slice(6, 8)}` : null, venue: p.number || 'EPO', authors: '', detail: 'Espacenet / EPO OPS' });
  } catch {}
  return [...out.values()];
}
