// Dati chiave (fatturato, dipendenti, stabilimenti, capacità, fondazione, investimenti):
// frasi con numeri trovate nelle fonti, ripulite, con anno e link. Nessuna stima.

const norm = s => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
const KINDS = [
  ['revenue', /fatturat|ricavi|revenue|turnover|sales of|vendite|umsatz|营收|销售额/i],
  ['employees', /dipendent|addetti|employees|employs|employing|staff of|workforce|people employed|mitarbeiter|collaboratori|员工/i],
  ['plants', /stabiliment|plant|factory|facilit|sede produttiva|production site|werk|工厂|基地/i],
  ['capacity', /capacit|tonnellat|tons|tonnes|m²|sqm|square meters|metri quadr|million square|linee? di produzione|production lines?|产能/i],
  ['founded', /fondat|founded|established in|gegründet|成立/i],
  ['investment', /investiment|invest|acquisi|acquired|merger|fusione|finanziament|funding/i],
];
export const FACT_LABELS = { revenue: 'Revenue', employees: 'Employees', plants: 'Plants and sites', capacity: 'Production capacity', founded: 'Founded', history: 'History', investment: 'Investments and acquisitions' };

// Prefissi per cui il trattino è legittimo (in-house, co-founder, high-performance…).
const KEEP_HYPHEN = new Set(['in', 'co', 're', 'non', 'pre', 'self', 'high', 'low', 'well', 'long', 'full', 'multi', 'anti', 'semi', 'post', 'cross', 'next', 'cost', 'eco', 'bio', 'e', 'ex', 'pro', 'top', 'end', 'one', 'two', 'all', 'off', 'on', 'by']);

// Ripulisce il testo estratto da pagine e PDF: titoli markdown, "[...]", icone, sillabazione dei PDF.
export function cleanText(s) {
  let t = String(s || '')
    .replace(/\\+/g, ' ')
    .replace(/\[\s*(?:\.\.\.|…)\s*\]/g, ' ')
    .replace(/#{1,6}\s*/g, ' . ')
    .replace(/\b(?:Section icon|Media icon|LinkedIn logo|icon(?=[A-Z]))/g, ' ')
    .replace(/(\p{L}{1,4})-\s?(\p{Ll}{2,5})\b/gu, (m, a, b) => KEEP_HYPHEN.has(a.toLowerCase()) ? m : a + b)
    .replace(/\s+/g, ' ').replace(/\s+([.,;:])/g, '$1').replace(/(\.\s*){2,}/g, '. ').trim();
  t = t.replace(/^(?:[.\s-]*)/, '').replace(/^(?:[A-Z0-9&®'’/.-]{2,}[.,]?\s+){2,}(?=[A-Z][a-z])/, '');
  return t.trim();
}

// Forme giuridiche: "OÜ Alphafilm" o "Alphafilm LLC" sono un'altra azienda (omonimo).
const LEGAL = /^(oü|ou|as|ab|oy|llc|l\.l\.c\.|inc\.?|ltd\.?|limited|gmbh|ag|bv|b\.v\.|nv|sas|sarl|s\.a\.|sa|pty|corp\.?|kft|sro|s\.r\.o\.|zrt|plc)$/i;
export function isHomonym(sentence, company) {
  const names = [company.name, ...(company.aliases || [])].map(norm).filter(Boolean);
  const own = new Set(names.join(' ').split(/\s+/));
  const words = String(sentence).split(/\s+/);
  for (let i = 0; i < words.length; i++) {
    const w = norm(words[i]).replace(/[,.;:()]+$/, '');
    if (!names.some(n => n.split(/\s+/)[0] === w)) continue;
    for (const adj of [words[i - 1], words[i + 1]]) {
      const a = norm(adj || '').replace(/[,;:()]+$/, '');
      if (a && LEGAL.test(a) && !own.has(a)) return true;
    }
  }
  return false;
}

export function factYear(text, publishedAt) {
  const ys = (String(text).replace(/(?:founded|fondat\w*|established|since|dal|gegründet|nata|nato)\b[^.]{0,30}?\b(?:19|20)\d\d/gi, ' ').match(/\b(19[5-9]\d|20[0-3]\d)\b/g) || []).map(Number).filter(y => y <= new Date().getFullYear());
  if (ys.length) return Math.max(...ys);
  return publishedAt && Number.isFinite(Date.parse(publishedAt)) ? new Date(publishedAt).getUTCFullYear() : null;
}

export const factKey = t => norm(t).replace(/[^a-z0-9]+/g, '');

// Valida e normalizza una frase: restituisce { kind, text, year } oppure null.
export function validateFact(raw, company, { titleHasName = false, publishedAt = null } = {}) {
  const s = cleanText(raw);
  if (s.length < 30 || s.length > 420 || !/\d/.test(s)) return null;
  if (/phone number|sic code|naics|cookie|privacy|general conditions|terms of use|read more|leggi anche|related news|share:|log ?in|book a demo|sign up|subscribe/i.test(s)) return null;
  const upper = (s.match(/[A-Z]/g) || []).length / Math.max(1, (s.match(/\p{L}/gu) || []).length);
  if (upper > 0.45) return null;
  const names = [company.name, ...(company.aliases || [])].map(norm).filter(n => n.length >= 3);
  const ns = norm(s);
  if (!names.some(n => ns.includes(n)) && !(titleHasName && /\b(the company|l'azienda|la societa|the group|il gruppo|its|sua|suo|we|our|noi)\b/.test(ns))) return null;
  if (isHomonym(s, company)) return null;
  const kind = KINDS.find(([, re]) => re.test(s))?.[0];
  if (!kind) return null;
  if (kind === 'revenue' && !/(€|eur|euro|\$|usd|milion|million|mln|bn|billion|miliard|mio|rmb|cny|yuan)/i.test(s)) return null;
  const founded = kind === 'founded' ? Math.min(...(s.match(/\b(1[89]\d\d|20[0-3]\d)\b/g) || ['0']).map(Number)) : 0;
  return { kind, text: s, year: founded || factYear(s, publishedAt) };
}

export function extractFacts(result, company) {
  const names = [company.name, ...(company.aliases || [])].map(norm).filter(n => n.length >= 3);
  const titleHasName = names.some(n => norm(result.title).includes(n));
  const out = [];
  const source = (() => { try { return new URL(result.url).hostname.replace(/^www\./, ''); } catch { return ''; } })();
  for (const raw of cleanText(result.summary).split(/(?<=[.!?。])\s+/)) {
    const f = validateFact(raw, company, { titleHasName, publishedAt: result.publishedAt });
    if (f) out.push({ ...f, url: result.url, source, publishedAt: result.publishedAt || null });
  }
  return out;
}

// Dirigenti citati nelle fonti ("Mario Rossi, Chief Executive Officer", "CEO Mario Rossi").
const ROLE = '(?:Chief [A-Z][a-z]+ Officer|CEO|CFO|CTO|COO|CMO|CIO|CCO|Head of [A-Z][\\w&/ ]{2,30}|Director[\\w ]{0,25}|Direttore[\\w ]{0,25}|Direttrice[\\w ]{0,25}|Amministratore Delegato|Presidente|President|Vice President[\\w ]{0,25}|Managing Director|General Manager|Co-Founder|Founder|Fondatore|Fondatrice|Dirigente)';
const NAME = "([A-ZÀ-Ý][a-zà-ÿ'’]+(?:\\s+[A-ZÀ-Ý][a-zà-ÿ'’]+){1,2})";
export function extractLeaders(text, company) {
  const t = cleanText(text);
  const own = norm(company.name);
  const out = new Map();
  for (const re of [new RegExp(`${NAME}\\s*[,–-]\\s*(${ROLE})`, 'g'), new RegExp(`(${ROLE})\\s*[,:]?\\s+${NAME}`, 'g')]) {
    for (const m of t.matchAll(re)) {
      const [name, role] = re.source.startsWith('(' + NAME.slice(1)) || m[1].split(/\s+/).every(w => /^[A-ZÀ-Ý]/.test(w)) && !new RegExp('^' + ROLE + '$').test(m[1]) ? [m[1], m[2]] : [m[2], m[1]];
      if (!name || norm(name).includes(own) || /linkedin|section|company|overview|leadership|employees/i.test(name)) continue;
      out.set(norm(name), { name: name.trim(), role: role.trim() });
    }
  }
  return [...out.values()].slice(0, 20);
}

export async function searchFacts(company, search) {
  const n = '"' + company.name.replaceAll('"', '') + '"';
  const queries = [`${n} fatturato dipendenti`, `${n} revenue employees company profile`, `${n} stabilimento capacità produttiva`, `${n} plant production capacity investment`, `${n} CEO management team`];
  for (const alias of (company.aliases || []).filter(a => norm(a) !== norm(company.name)).slice(0, 2)) {
    queries.push(`"${alias.replaceAll('"', '')}" revenue employees founded funding`);
  }
  queries.push(`${n} founded funding annual results`);
  const facts = new Map(), leaders = new Map(), errors = [];
  for (const q of queries) {
    try {
      for (const r of await search(q, { topic: 'general', recent: false, maxResults: 10, advanced: true })) {
        for (const f of extractFacts(r, company)) if (!facts.has(factKey(f.text))) facts.set(factKey(f.text), f);
        if (/\b(ceo|cfo|cto|chief|head of|director|direttore|amministratore|founder|fondatore|management|leadership|team)\b/i.test(r.summary || ''))
          for (const l of extractLeaders(r.summary, company)) if (!leaders.has(norm(l.name))) leaders.set(norm(l.name), { ...l, sourceUrl: r.url, sourceTitle: r.title || '', sourceText: String(r.summary || '').slice(0, 3000) });
      }
    } catch (e) { errors.push(e.public ? e.message : 'Facts search failed.'); }
  }
  return { facts: [...facts.values()].slice(0, 40), leaders: [...leaders.values()], errors };
}
