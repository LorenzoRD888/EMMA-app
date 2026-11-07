// Wider coverage: weak signals (job openings, certifications, distributors,
// trade press in the company's language) and a second search round when an
// update finds little outside the company's own website.
// Everything stays rule-based: each extra search is listed in the update log.

const quote = v => '"' + String(v || '').replaceAll('"', '').trim() + '"';
const host = u => { try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } };

// Language of the company's country, with the words used by its trade press.
const LANGS = {
  it: { re: /ital/i, label: 'Italian', interview: 'intervista', press: 'intervista OR articolo OR settore OR fiera OR mercato OR stabilimento', jobs: 'offerte di lavoro OR posizioni aperte OR assunzioni' },
  de: { re: /germ|deutsch|österr|austria|schweiz|switz/i, label: 'German', interview: 'Interview', press: 'Interview OR Fachartikel OR Branche OR Messe OR Markt OR Werk', jobs: 'Stellenangebote OR Karriere OR Jobs' },
  fr: { re: /fran|belg/i, label: 'French', interview: 'entretien OR interview', press: 'entretien OR article OR secteur OR salon OR marché OR usine', jobs: "offres d'emploi OR recrutement" },
  es: { re: /spa|españa|mexic|argent|chile|colomb|peru/i, label: 'Spanish', interview: 'entrevista', press: 'entrevista OR artículo OR sector OR feria OR mercado OR planta', jobs: 'empleo OR ofertas de trabajo' },
  pt: { re: /portug|brazil|brasil/i, label: 'Portuguese', interview: 'entrevista', press: 'entrevista OR artigo OR setor OR feira OR mercado OR fábrica', jobs: 'vagas OR emprego' },
  nl: { re: /netherl|nederland|holland|dutch/i, label: 'Dutch', interview: 'interview', press: 'interview OR artikel OR sector OR beurs OR markt OR fabriek', jobs: 'vacatures OR werken bij' },
  ja: { re: /japan|giappone/i, label: 'Japanese', interview: 'インタビュー', press: 'インタビュー OR 業界 OR 展示会 OR 工場', jobs: '求人 OR 採用' },
  ko: { re: /korea|corea/i, label: 'Korean', interview: '인터뷰', press: '인터뷰 OR 업계 OR 전시회 OR 공장', jobs: '채용' },
  zh: { re: /china|cina|taiwan|hong kong|中国/i, label: 'Chinese', interview: '采访 OR 专访', press: '采访 OR 行业 OR 展会 OR 工厂', jobs: '招聘' },
  vi: { re: /vietnam/i, label: 'Vietnamese', interview: 'phỏng vấn', press: 'phỏng vấn OR ngành OR triển lãm OR nhà máy', jobs: 'tuyển dụng' },
};
export function companyLanguage(country) { const c = String(country || ''); if (!c) return null; for (const [code, v] of Object.entries(LANGS)) if (v.re.test(c)) return { code, ...v }; return null; }

const base = (maxResults, extra = {}) => ({ engine: 'web', topic: 'general', recent: false, maxResults, ...extra });

// Weak signals, searched in every wide update.
export function signalTasks(company, { maxResults = 10, mode = 'wide' } = {}) {
  if (mode !== 'wide') return [];
  const name = quote(company.name), tasks = [];
  const add = (query, label, extra) => tasks.push({ ...base(maxResults, extra), query, label, signal: true });
  add(`${name} (jobs OR careers OR hiring OR vacancy OR "job opening")`, 'Signals · job openings');
  add(`${name} jobs`, 'Signals · job openings on LinkedIn', { domain: 'linkedin.com' });
  add(`${name} (certified OR certification OR "UL listed" OR UL OR IEC OR TÜV OR "ISO 9001" OR "ISO 14001")`, 'Signals · certifications');
  add(`${name} (distributor OR "distribution agreement" OR "exclusive distributor" OR reseller OR dealer OR "sales partner")`, 'Signals · distributors and channels');
  const lang = companyLanguage(company.country);
  if (lang && lang.code !== 'en') {
    add(`${name} ${lang.press}`, `Signals · ${lang.label} trade press`);
    add(`${name} ${lang.jobs}`, `Signals · job openings (${lang.label})`);
  }
  return tasks;
}

// Results from outside the company's own website.
export function externalCount(items, website) {
  const own = host(website);
  return items.filter(i => i.verdict === 'accept' && host(i.url) && host(i.url) !== own).length;
}

// When does an update need a second round?  Few external results now AND few in the archive.
export function needsSecondRound({ externalNow = 0, externalArchive = 0 } = {}) {
  if (externalNow >= 3) return { needed: false };
  if (externalArchive >= 8) return { needed: false };
  return { needed: true, reason: `Only ${externalNow} result${externalNow === 1 ? '' : 's'} from outside the company's website in this update and ${externalArchive} in the last 6 months` };
}

// Second round: different sources and no date limit.
export function gapTasks(company, { maxResults = 10, people = [] } = {}) {
  const name = quote(company.name), tasks = [];
  const add = (query, label, extra) => tasks.push({ ...base(maxResults, extra), query, label: 'Second round · ' + label, gap: true });
  const own = host(company.website);
  const context = String(company.keywords || company.sector || '').split(/[,;]/)[0].trim();
  add(`${name}${context ? ' ' + context : ''}`, 'older articles, no date limit', own ? { excludeDomains: [own] } : {});
  add(`${name} (interview OR podcast OR webinar OR conference OR keynote OR panel)`, 'interviews, podcasts and talks');
  add(`${name} (interview OR presentation OR conference OR webinar)`, 'videos', { domain: 'youtube.com', media: true });
  for (const p of people.filter(p => String(p).trim().split(/\s+/).length >= 2).slice(0, 3)) add(`${quote(p)} ${name}`, 'person · ' + p);
  const lang = companyLanguage(company.country);
  if (lang && lang.code !== 'en') add(`${name} ${lang.interview} OR ${lang.press.split(' OR ').slice(1, 4).join(' OR ')}`, `${lang.label} press`);
  add(`${name} (supplier OR customer OR "works with" OR "case study" OR award OR exhibitor)`, 'customers, suppliers and fairs', own ? { excludeDomains: [own] } : {});
  return tasks.slice(0, 8);
}
