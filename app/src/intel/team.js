// People and history from the company's own website (About, Team, Leadership,
// History pages): the most reliable source for who runs the company.
const norm = s => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();

const ROLE = String.raw`(?:co-?founder|founder|fondatore|fondatrice|ceo|cfo|cto|coo|cmo|cio|chief [a-z]+ officer|managing director|general manager|executive director|president|vice president|vp(?: of)? [a-z]+|chairman|chairwoman|chair|owner|partner|managing partner|head of [a-z &]+|director(?: of [a-z &]+)?|manager(?: [a-z]+)?|lead(?: [a-z]+)?|amministratore delegato|direttore(?: [a-z]+)?|presidente|responsabile [a-z ]+|consultant|account (?:manager|director)|principal)`;
const ROLE_RE = new RegExp(`^(?:${ROLE})(?:\\s*(?:&|and|/|,)\\s*(?:${ROLE}))*$`, 'i');
const ROLE_ANY = new RegExp(`\\b${ROLE}\\b`, 'i');
const NOT_NAME = new Set(`business development general counsel national association executive management location vice president chief officer director founder company group team head senior junior global regional the our and of for with about contact services service news home page media relations public strategy marketing digital content market research branding insights global communications agency office offices asia greater china korea singapore europe america read more learn view all meet leadership board advisory staff people partners clients case studies careers join us privacy policy cookie terms`.split(/\s+/));

// "Jane Smith", "Jean-Luc O'Neil", "J. R. Doe": 2–4 capitalised words, no role or business words.
export function isPersonName(name) {
  const words = String(name || '').trim().split(/\s+/);
  if (words.length < 2 || words.length > 4) return false;
  return words.every(w => /^(?:[A-ZÀ-ÝŁŚŻ][a-zà-ÿłśżçñ'’-]{1,}|[A-Z]\.)$/u.test(w) && !NOT_NAME.has(norm(w).replace(/\.$/, '')))
    && words.some(w => w.length > 2);
}

// People with their role, from the text lines of a page.
export function extractTeam(lines) {
  const out = new Map();
  const add = (name, role) => { name = String(name || '').replace(/\s+/g, ' ').trim(); role = String(role || '').replace(/\s+/g, ' ').trim().replace(/[.,;:]$/, ''); if (isPersonName(name) && role.length <= 80 && ROLE_ANY.test(role) && !out.has(norm(name))) out.set(norm(name), { name, role }); };
  const NAME = String.raw`((?:[A-ZÀ-Ý][a-zà-ÿ'’-]+|[A-Z]\.)(?:\s+(?:[A-ZÀ-Ý][a-zà-ÿ'’-]+|[A-Z]\.)){1,3})`;
  const inline = [new RegExp(`${NAME}\\s*(?:,|–|—|-|\\||:)\\s*((?:${ROLE})(?:\\s*(?:&|and|/|,)\\s*(?:${ROLE}))*)`, 'gi'), new RegExp(`((?:${ROLE}))\\s*(?:,|:|–|—|-)\\s*${NAME}`, 'gi')];
  const story = [new RegExp(`(?:founded|established|started|created|fondata|fondato)\\s+(?:in\\s+\\d{4}\\s+)?by\\s+${NAME}`, 'gi'), new RegExp(`${NAME},?\\s+(?:is\\s+)?(?:our|the|its)\\s+((?:${ROLE}))`, 'gi')];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const re of inline) for (const m of line.matchAll(re)) { const nameFirst = /^[A-ZÀ-Ý]/.test(m[1]) && !ROLE_RE.test(m[1]); nameFirst ? add(m[1], m[2]) : add(m[2], m[1]); }
    for (const m of line.matchAll(story[0])) add(m[1], 'Founder');
    for (const m of line.matchAll(story[1])) add(m[1], m[2]);
    // Name on one line, role on the next (typical "team" cards).
    const next = lines[i + 1] || '';
    if (isPersonName(line) && ROLE_RE.test(next.replace(/[.,;:]$/, '').trim())) add(line, next);
  }
  return [...out.values()].slice(0, 40);
}

// Sentences that tell the company's history (founded, established, since…).
export function extractHistory(lines) {
  const text = lines.join(' ').replace(/\s+/g, ' ');
  const sentences = lines.flatMap(l => l.split(/(?<=[.!?])\s+/)).map(x => x.trim()).filter(s => s.length >= 25 && s.length <= 320);
  const out = [], seen = new Set();
  for (const s of sentences) {
    if (!/\b(1[89]\d\d|20[0-4]\d)\b/.test(s)) continue;
    if (!/\b(founded|established|since|started|launched|history|began|opened|incorporated|fondat[ao]|nata nel|dal \d{4}|storia)\b/i.test(s)) continue;
    const k = norm(s).slice(0, 80); if (seen.has(k)) continue; seen.add(k); out.push(s.trim());
    if (out.length >= 6) break;
  }
  const founded = (text.match(/\b(?:founded|established|incorporated|fondat[ao])\b[^.]{0,40}?\b(1[89]\d\d|20[0-4]\d)\b/i) || text.match(/\bsince\s+(1[89]\d\d|20[0-4]\d)\b/i))?.[1] || null;
  return { sentences: out, founded: founded ? Number(founded) : null };
}

const PAGE_RE = /(about|team|leadership|people|who[\s-]?we[\s-]?are|our[\s-]?story|history|founder|management|company|chi[\s-]?siamo|azienda|storia|unternehmen|ueber[\s-]?uns|uber[\s-]?uns|qui[\s-]?sommes|a[\s-]?propos|quienes[\s-]?somos|staff|board|executive)/i;
export function teamPageCandidates(website, { urls = [], sections = [] } = {}) {
  let base; try { base = new URL(website); } catch { return []; }
  const same = u => { try { return new URL(u).hostname.replace(/^www\./, '') === base.hostname.replace(/^www\./, ''); } catch { return false; } };
  const found = [...sections.filter(s => PAGE_RE.test(s.label || '') || PAGE_RE.test(s.url || '')).map(s => s.url), ...urls.filter(u => PAGE_RE.test(new URL(u).pathname))].filter(same);
  const guesses = ['/about', '/about-us', '/team', '/our-team', '/leadership', '/who-we-are', '/our-story', '/company'].map(p => new URL(p, base.origin).href);
  return [...new Set([base.href, ...found, ...guesses])].slice(0, 10);
}
