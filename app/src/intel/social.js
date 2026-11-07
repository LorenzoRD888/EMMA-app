import {isAccessWall} from './preview.js';
// Persone e post LinkedIn, ricavati SOLO dai risultati dei motori di ricerca
// (EMMA non apre linkedin.com: il sito non consente lo scraping). Si vede quindi
// ciò che è indicizzato pubblicamente: nome, ruolo, località, estratto dei post.

const norm = s => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
const has = (text, name) => {
  const t = ' ' + norm(text) + ' ', n = norm(name);
  let i = -1;
  while ((i = t.indexOf(n, i + 1)) !== -1) if (!/[a-z0-9]/.test(t[i - 1] || ' ') && !/[a-z0-9]/.test(t[i + n.length] || ' ')) return true;
  return false;
};
const names = c => [c.name, ...(c.aliases || [])].filter(n => n && n.length >= 3);
const slug = s => norm(s).replace(/[^a-z0-9]+/g, '');

export function parseProfile(result, company) {
  const url = String(result.url || '');
  if (!/linkedin\.com\/in\//i.test(url)) return null;
  const title = String(result.title || '').replace(/\s*[|·]\s*LinkedIn.*$/i, '').trim();
  const text = `${title} ${result.summary || ''}`;
  if (!names(company).some(n => has(text, n))) return null;
  const parts = title.split(/\s+[-–—]\s+/).map(s => s.trim()).filter(Boolean);
  const name = parts[0];
  if (!name || name.length > 60 || /linkedin|profil|jobs|lavoro/i.test(name) || name.split(/\s+/).length > 5) return null;
  let role = parts.slice(1).filter(p => !names(company).some(n => norm(p).includes(norm(n)))).join(' · ');
  const presso = parts.slice(1).join(' - ').match(/^(.*?)\s+(?:presso|at|@|bei|chez)\s+(.+)$/i);
  if (presso) role = presso[1];
  const summary = String(result.summary || '');
  const location = summary.match(/(?:Località|Location|Standort|Lieu)\s*:\s*([^·|.\n]+)/i)?.[1]?.trim() || '';
  const current = /(?:Esperienza|Experience|Berufserfahrung)\s*:\s*([^·|\n]+)/i.exec(summary)?.[1] || '';
  return {
    name, role: role.replace(/\s*[·|]\s*LinkedIn.*$/i, '').slice(0, 160), location: location.slice(0, 80), url: url.split('?')[0],
    current: current ? names(company).some(n => has(current, n)) : null,
    snippet: summary.replace(/\s+/g, ' ').slice(0, 400),
  };
}

export function parsePost(result, company) {
  const url = String(result.url || '');
  if (!/linkedin\.com\/(posts|feed\/update|pulse)\//i.test(url)) return null;
  const title = String(result.title || '').replace(/\s*\|\s*\d+\s+(comments?|commenti|reactions?|reazioni).*$/i, '').replace(/\s*\|\s*LinkedIn\s*$/i, '').trim();
  const text = `${title} ${result.summary || ''}`;
  const inSlug = names(company).some(n => url.toLowerCase().includes(slug(n)));
  if (!inSlug && !names(company).some(n => has(text, n))) return null;
  const m = title.match(/^(.+?)\s+(?:on|su|auf|sur)\s+LinkedIn\s*:\s*(.*)$/i);
  const author = m ? m[1].trim() : '';
  const body = (m ? m[2] : title).replace(/^["“]|["”]$/g, '');
  const fromCompany = !!author && names(company).some(n => has(author, n));
  return { url: url.split('?')[0], author, fromCompany, title: (author ? `${author}: ` : '') + body.slice(0, 220), summary: String(isAccessWall(result.summary)?body:(result.summary || body)).slice(0, 2000), publishedAt: result.publishedAt || null, provider: result.provider || null };
}

export function parseCompanyPage(result, company) {
  if (!/linkedin\.com\/company\//i.test(result.url || '')) return null;
  const text = `${result.title} ${result.summary}`;
  if (!names(company).some(n => has(text, n))) return null;
  const followers = text.match(/([\d.,]+\s*(?:k|mila)?)\s+(?:follower|followers)/i)?.[1] || null;
  const size = text.match(/(\d[\d.,]*\s*[-–]\s*\d[\d.,]*|\d[\d.,]*\+)\s*(?:dipendenti|employees|Mitarbeiter)/i)?.[1] || null;
  const onLinkedIn = text.match(/([\d.,]+)\s+(?:dipendenti su LinkedIn|employees on LinkedIn|associated members)/i)?.[1] || null;
  return { url: result.url.split('?')[0], followers, size, onLinkedIn };
}

export async function searchPeople(company, search, { maxResults = 20 } = {}) {
  const n = '"' + company.name.replaceAll('"', '') + '"';
  const queries = [`${n} linkedin profile`, `${n} manager OR director OR head`, `${n} engineer OR R&D OR technical`, `${n} sales OR export OR marketing`];
  const people = new Map(), pages = [], errors = [];
  for (const q of queries) {
    try {
      for (const r of await search(q, { topic: 'general', recent: false, maxResults, domain: 'linkedin.com' })) {
        const p = parseProfile(r, company); if (p && !people.has(p.url)) people.set(p.url, { ...p, query: q });
        const page = parseCompanyPage(r, company); if (page) pages.push(page);
      }
    } catch (e) { errors.push(e.public ? e.message : 'LinkedIn search failed.'); }
  }
  return { people: [...people.values()], companyPage: pages[0] || null, errors };
}

export async function searchPosts(company, search, { maxResults = 20 } = {}) {
  const n = '"' + company.name.replaceAll('"', '') + '"';
  const out = new Map(), errors = [];
  for (const q of [`${n} posts`, `${n} linkedin post news`]) {
    try {
      for (const r of await search(q, { topic: 'general', recent: false, maxResults, domain: 'linkedin.com' })) {
        const p = parsePost(r, company); if (p && !out.has(p.url)) out.set(p.url, { ...p, query: q });
      }
    } catch (e) { errors.push(e.public ? e.message : 'LinkedIn post search failed.'); }
  }
  return { posts: [...out.values()], errors };
}
