import { createLearning } from './learning.js';
import {publicMediaType} from '../media-research.js';
// Livello "intelligence" di EMMA: per ogni azienda tiene traccia di
//   · cosa fa      → profilo dal sito ufficiale (descrizione, menu, aree di business, prodotti)
//   · cosa pubblica → pagine nuove del sito (news, comunicati, prodotti, documenti), articoli scientifici, brevetti
//   · a quali fiere partecipa → dal sito ufficiale e da fonti di terze parti, con stand e date
// e giudica la pertinenza delle notizie per scartare gli omonimi.

import { createHash, randomUUID } from 'node:crypto';
import { scanSite, readPage, contextTerms } from './site-watch.js';
import { detectEvent, eventStatus, hasEventSignal, matchCatalog, FAIR_CATALOG } from './fairs.js';
import { searchPapers, searchPatents } from './publications.js';
import { leadFromText } from './preview.js';
import { sameEvent, isJobPosting } from './strategic-events.js';
import { mentionsProduct } from './products.js';
import { isProfilePage, specificTerms, strongSignal, probablyOld, isJunkSite } from './relevance.js';
import { isPersonName, extractTeam, extractHistory, teamPageCandidates } from './team.js';
import { migrateKeyPages, pageLines } from './key-pages.js';
import { migrateSectors } from './sectors.js';
import { searchPeople, searchPosts } from './social.js';
import { searchFacts, FACT_LABELS, validateFact, factKey, extractFacts } from './facts.js';

// Vocabolario tecnico generico: una pubblicazione/brevetto deve parlare di materiali o tecnologia.
const TECH = /film|polymer|polimer|polyester|poliester|\bpet\b|coating|insulat|isolament|dielectric|dielettr|photovoltaic|fotovolta|solar|backsheet|module|adhesive|adesiv|laminat|membrane|label|etichett|printing|stampa|flexible|circuit|packaging|electrical|elettric|material|resin|resin|surface|thermal|barrier|electrode|battery|motor|winding|partial discharge|aging|ageing|weather|uv /i;
import { localDayStart } from '../market-store.js';
import { searchReady, activeProvider } from '../search/providers.js';

const hash = s => createHash('sha256').update(s).digest('hex').slice(0, 32);
const now = () => new Date().toISOString();
const host = u => { try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } };
const norm = s => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
const nameInTitle = (title, company) => {
  const text = ' ' + norm(title).replace(/[^\p{L}\p{N}]+/gu, ' ') + ' ';
  const aliases = Array.isArray(company.aliases) ? company.aliases : JSON.parse(company.aliases || '[]');
  return [company.name, ...aliases].map(n=>norm(n).replace(/[^\p{L}\p{N}]+/gu,' ').trim()).filter(n => n.length >= 3).some(n => text.includes(' ' + n + ' '));
};
const DAY = 86400000;

// Domini che producono quasi solo rumore per un'analisi competitiva.
export const NOISY_DOMAINS = ['facebook.com', 'instagram.com', 'tiktok.com', 'pinterest.com', 'pinterest.it', 'threads.net', 'spotify.com', 'music.apple.com', 'soundcloud.com', 'genius.com', 'deezer.com', 'last.fm', 'imdb.com', 'reddit.com', 'quora.com'];
const isNoisy = u => { const h = host(u); return NOISY_DOMAINS.some(d => h === d || h.endsWith('.' + d)); };

export function migrateIntel(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS site_pages(id TEXT PRIMARY KEY,companyId TEXT NOT NULL REFERENCES companies(id),url TEXT NOT NULL,title TEXT NOT NULL DEFAULT '',summary TEXT NOT NULL DEFAULT '',kind TEXT NOT NULL,via TEXT NOT NULL,publishedAt TEXT,lastmod TEXT,firstSeen TEXT NOT NULL,updatedAt TEXT,baseline INTEGER NOT NULL DEFAULT 0,UNIQUE(companyId,url));
  CREATE INDEX IF NOT EXISTS site_pages_seen ON site_pages(companyId,firstSeen);
  CREATE INDEX IF NOT EXISTS site_pages_url ON site_pages(url);
  CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY,companyId TEXT NOT NULL REFERENCES companies(id),fairKey TEXT NOT NULL,fairName TEXT NOT NULL,year INTEGER NOT NULL DEFAULT 0,startDate TEXT,endDate TEXT,city TEXT NOT NULL DEFAULT '',sector TEXT NOT NULL DEFAULT '',booth TEXT,sourceUrl TEXT NOT NULL,sourceTitle TEXT NOT NULL DEFAULT '',official INTEGER NOT NULL DEFAULT 0,sources INTEGER NOT NULL DEFAULT 1,firstSeen TEXT NOT NULL,baseline INTEGER NOT NULL DEFAULT 0,hidden INTEGER NOT NULL DEFAULT 0,UNIQUE(companyId,fairKey,year));
  CREATE TABLE IF NOT EXISTS publications(id TEXT PRIMARY KEY,companyId TEXT NOT NULL REFERENCES companies(id),kind TEXT NOT NULL,url TEXT NOT NULL,title TEXT NOT NULL,publishedAt TEXT,venue TEXT NOT NULL DEFAULT '',authors TEXT NOT NULL DEFAULT '',detail TEXT NOT NULL DEFAULT '',firstSeen TEXT NOT NULL,baseline INTEGER NOT NULL DEFAULT 0,UNIQUE(companyId,url));
  CREATE TABLE IF NOT EXISTS company_intel(companyId TEXT PRIMARY KEY REFERENCES companies(id),profile TEXT NOT NULL DEFAULT '{}',terms TEXT NOT NULL DEFAULT '[]',methods TEXT NOT NULL DEFAULT '[]',errors TEXT NOT NULL DEFAULT '[]',ai TEXT,siteScannedAt TEXT,pubsScannedAt TEXT,fairsScannedAt TEXT);`);
  const cols = (t) => db.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name);
  if (!cols('news').includes('review')) db.exec("ALTER TABLE news ADD COLUMN review INTEGER NOT NULL DEFAULT 0");
  if (!cols('news').includes('reviewReason')) {
    db.exec("ALTER TABLE news ADD COLUMN reviewReason TEXT NOT NULL DEFAULT ''");
    // Una tantum: le notizie già raccolte da social e siti musicali passano in "Da verificare".
    const mark = db.prepare("UPDATE news SET review=1,reviewReason='Social or irrelevant site' WHERE id=?");
    for (const n of db.prepare('SELECT id,url FROM news').all()) if (isNoisy(n.url)) mark.run(n.id);
  }
  for (const t of ['news', 'site_pages']) for (const c of ['image', 'lead']) if (!cols(t).includes(c)) db.exec(`ALTER TABLE ${t} ADD COLUMN ${c} TEXT NOT NULL DEFAULT ''`);
  db.exec(`CREATE TABLE IF NOT EXISTS people(id TEXT PRIMARY KEY,companyId TEXT NOT NULL REFERENCES companies(id),name TEXT NOT NULL,role TEXT NOT NULL DEFAULT '',location TEXT NOT NULL DEFAULT '',url TEXT NOT NULL,current INTEGER,snippet TEXT NOT NULL DEFAULT '',query TEXT NOT NULL DEFAULT '',firstSeen TEXT NOT NULL,lastSeen TEXT NOT NULL,baseline INTEGER NOT NULL DEFAULT 0,UNIQUE(companyId,url));
  CREATE TABLE IF NOT EXISTS facts(id TEXT PRIMARY KEY,companyId TEXT NOT NULL REFERENCES companies(id),kind TEXT NOT NULL,text TEXT NOT NULL,url TEXT NOT NULL,source TEXT NOT NULL DEFAULT '',publishedAt TEXT,firstSeen TEXT NOT NULL,hidden INTEGER NOT NULL DEFAULT 0,UNIQUE(companyId,text));`);
  if (!cols('news').includes('foundVia')) db.exec("ALTER TABLE news ADD COLUMN foundVia TEXT NOT NULL DEFAULT ''");
  if (!cols('facts').includes('year')) db.exec('ALTER TABLE facts ADD COLUMN year INTEGER');
  if (!cols('people').includes('source')) db.exec("ALTER TABLE people ADD COLUMN source TEXT NOT NULL DEFAULT ''");
  // Pulizia v23: testi dei dati chiave ripuliti, omonimi (es. "OÜ Alphafilm") e doppioni rimossi, anno calcolato; ruoli senza "· LinkedIn".
  if (!db.prepare("SELECT 1 FROM preferences WHERE key='cleanup:v23'").get()) {
    const seen = new Set();
    for (const f of db.prepare('SELECT * FROM facts ORDER BY firstSeen').all()) {
      const co = db.prepare('SELECT * FROM companies WHERE id=?').get(f.companyId);
      const v = co && validateFact(f.text, { ...co, aliases: JSON.parse(co.aliases || '[]') }, { titleHasName: true, publishedAt: f.publishedAt });
      const key = f.companyId + (v ? factKey(v.text) : '');
      if (!v || seen.has(key)) { db.prepare('DELETE FROM facts WHERE id=?').run(f.id); continue; }
      seen.add(key);
      try { db.prepare('UPDATE facts SET text=?,kind=?,year=? WHERE id=?').run(v.text, v.kind, v.year, f.id); } catch { db.prepare('DELETE FROM facts WHERE id=?').run(f.id); }
    }
    db.prepare("UPDATE people SET role=trim(replace(replace(role,' · LinkedIn',''),'| LinkedIn',''))").run();
    db.prepare("INSERT OR REPLACE INTO preferences(key,value) VALUES('cleanup:v23','true')").run();
  }
  db.exec(`CREATE TABLE IF NOT EXISTS daily_hidden(kind TEXT NOT NULL,itemId TEXT NOT NULL,hiddenAt TEXT NOT NULL,PRIMARY KEY(kind,itemId));`);
  db.exec(`CREATE TABLE IF NOT EXISTS discoveries(id TEXT PRIMARY KEY,key TEXT NOT NULL UNIQUE,name TEXT NOT NULL,topic TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',country TEXT NOT NULL DEFAULT '',founded TEXT NOT NULL DEFAULT '',funding TEXT NOT NULL DEFAULT '',sources TEXT NOT NULL DEFAULT '[]',firstSeen TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'new');`);
  for (const c of ['dateHow', 'dateNote']) if (!cols('news').includes(c)) db.exec(`ALTER TABLE news ADD COLUMN ${c} TEXT NOT NULL DEFAULT ''`);
  if (!cols('news').includes('dateCheckedAt')) db.exec('ALTER TABLE news ADD COLUMN dateCheckedAt TEXT');
  for (const [name, definition] of [
    ['eventType', "TEXT NOT NULL DEFAULT ''"],
    ['eventDate', 'TEXT'],
    ['eventDateKind', "TEXT NOT NULL DEFAULT ''"],
    ['evidence', "TEXT NOT NULL DEFAULT ''"],
    ['confidence', "TEXT NOT NULL DEFAULT ''"],
    ['eventBy', "TEXT NOT NULL DEFAULT ''"]
  ]) if (!cols('news').includes(name)) db.exec(`ALTER TABLE news ADD COLUMN ${name} ${definition}`);
  // Corrections made by the user to strategic events: reused for similar articles.
  db.exec(`CREATE TABLE IF NOT EXISTS event_corrections(id TEXT PRIMARY KEY,title TEXT NOT NULL,eventType TEXT NOT NULL,companyId TEXT NOT NULL DEFAULT '',createdAt TEXT NOT NULL);`);
  migrateKeyPages(db);
  for (const [n, d] of [['checked', "TEXT NOT NULL DEFAULT ''"], ['hidden', 'INTEGER NOT NULL DEFAULT 0']]) if (!cols('people').includes(n)) db.exec(`ALTER TABLE people ADD COLUMN ${n} ${d}`);
  // v31: entries that are not people ("Business Development", "General Counsel"…) came from noisy sources.
  if (!db.prepare("SELECT 1 FROM preferences WHERE key='cleanup:v31-people'").get()) {
    for (const p of db.prepare('SELECT id,name FROM people').all()) if (!isPersonName(p.name)) db.prepare('DELETE FROM people WHERE id=?').run(p.id);
    db.prepare("INSERT OR REPLACE INTO preferences(key,value) VALUES('cleanup:v31-people','true')").run();
  }
  db.exec(`CREATE TABLE IF NOT EXISTS profiles(id TEXT PRIMARY KEY,companyId TEXT NOT NULL,url TEXT NOT NULL,title TEXT NOT NULL DEFAULT '',summary TEXT NOT NULL DEFAULT '',source TEXT NOT NULL DEFAULT '',firstSeen TEXT NOT NULL,lastSeen TEXT NOT NULL,UNIQUE(companyId,url));`);
  // v30: directory and profile pages (LinkedIn company pages, Bloomberg profiles, RocketReach…) are not news: move them.
  if (!db.prepare("SELECT 1 FROM preferences WHERE key='cleanup:v30-profiles'").get()) {
    const rows = db.prepare('SELECT n.id,n.url,n.title,n.summary,n.discoveredAt,nc.companyId FROM news n JOIN news_companies nc ON nc.newsId=n.id').all().filter(r => isProfilePage(r.url));
    const ins = db.prepare('INSERT OR IGNORE INTO profiles(id,companyId,url,title,summary,source,firstSeen,lastSeen) VALUES(?,?,?,?,?,?,?,?)');
    const hasFts = db.prepare("SELECT 1 FROM sqlite_master WHERE name='news_fts'").get();
    db.transaction(() => {
      for (const r of rows) {
        ins.run(createHash('sha256').update(r.companyId + r.url).digest('hex').slice(0, 32), r.companyId, r.url, r.title, String(r.summary || '').slice(0, 1500), host(r.url), r.discoveredAt, r.discoveredAt);
        db.prepare('DELETE FROM news_companies WHERE newsId=?').run(r.id);
        if (hasFts) db.prepare('DELETE FROM news_fts WHERE id=?').run(r.id);
        db.prepare('DELETE FROM news WHERE id=?').run(r.id);
      }
      db.prepare("INSERT OR REPLACE INTO preferences(key,value) VALUES('cleanup:v30-profiles','true')").run();
    })();
  }
  migrateSectors(db);
  const has = t => db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(t);
  const rep = (table, col, pairs) => { if (!has(table) || !cols(table).includes(col)) return; for (const [a, b] of pairs) db.prepare(`UPDATE ${table} SET ${col}=replace(${col},?,?) WHERE instr(${col},?)>0`).run(a, b, a); };
  const VIA = [['Ricerca web · ', 'Web search · '], ['Notizie recenti', 'Recent news'], ['Attività, prodotti e tecnologie', 'Business, products and technologies'], ['Risultati e investimenti', 'Results and investments'], ['Accordi, impianti e acquisizioni', 'Deals, plants and acquisitions'], ['Ricerca, brevetti e normativa', 'Research, patents and regulation'], ['Fonti in italiano', 'Italian sources'], ['Nome alternativo', 'Alternative name'], ['Fonti e query in cinese', 'Chinese sources and queries'], ['Domini cinesi .cn', '.cn domains'], ['Pagine Baidu indicizzate da Tavily', 'Baidu pages indexed by web search'], ['Baidu tramite SerpApi', 'Baidu via SerpApi'], ['Baidu · nome internazionale', 'Baidu · international name'], ['Feed RSS', 'RSS feed'], ['Ricerca fiere', 'Trade fair search'], ['Partecipazione a una fiera', 'Trade fair participation'], ['Post LinkedIn (dai motori di ricerca)', 'LinkedIn post (from search engines)'], ['Pubblicato dalla pagina aziendale', 'Posted by the company page'], ['Cita l’azienda', 'Mentions the company'], ['Inserita da te', 'Added by you'], ['Aggiunta manualmente', 'Added manually'], ['Contesto: ', 'Context: '], ['Sito ufficiale', 'Official website'], ['Fiera di settore', 'Industry trade fair'], ['Nessun contesto definito', 'No context defined']];
  // v27: translate texts stored by earlier Italian versions.
  if (!db.prepare("SELECT 1 FROM preferences WHERE key='cleanup:v27-en'").get()) {
    rep('news', 'foundVia', VIA);
    rep('news', 'dateHow', [['metadati della pagina', 'page metadata'], ['dati strutturati della pagina', 'page structured data'], ['data indicata nella pagina', 'date shown in the page'], ['data nell’indirizzo', 'date in the address'], ['data indicata nel testo', 'date in the text'], ['ID del post LinkedIn', 'LinkedIn post ID'], ['motore di ricerca', 'search engine'], ['indicata dalla fonte', 'given by the source'], ['inserita da te', 'added by you'], ['sito ufficiale', 'official website']]);
    db.prepare("UPDATE news SET dateHow='given by the source' WHERE dateHow='fonte'").run();
    rep('news', 'dateNote', [['Data non trovata · il testo cita', 'Date not found · the text mentions'], ['Data non trovata: puoi indicarla tu', 'Date not found: you can set it'], ['Data non disponibile (post LinkedIn senza identificativo)', 'Date not available (LinkedIn post without ID)'], ['Data non trovata', 'Date not found']]);
    rep('news', 'reviewReason', [['Nessun termine del settore: possibile omonimo', 'No industry term: possible namesake'], ['Social o sito non pertinente', 'Social or irrelevant site'], ['Contiene un termine escluso:', 'Contains an excluded word:']]);
    rep('people', 'query', [['dirigenti citati nelle fonti', 'executives quoted in sources']]);
    rep('discoveries', 'sources', [['Notizie di finanziamento', 'Funding news']]);
    rep('company_intel', 'errors', [['Nessuna fonte strutturata trovata (API WordPress, RSS o sitemap): il sito verrà letto solo dalla homepage.', 'No structured source found (WordPress API, RSS or sitemap): only the homepage will be read.'], ['Homepage non raggiungibile', 'Homepage not reachable'], ['Sito ufficiale non indicato: aggiungilo nella scheda azienda.', 'No official website: add it in the company card.']]);
    if (has('events')) for (const f of FAIR_CATALOG) db.prepare('UPDATE events SET fairName=?,city=?,sector=? WHERE fairKey=?').run(f.name, f.city, f.sector, f.key);
    db.prepare("INSERT OR REPLACE INTO preferences(key,value) VALUES('cleanup:v27-en','true')").run();
  }
  // v28: the reasons inside "found via" and the update log were still in Italian.
  if (!db.prepare("SELECT 1 FROM preferences WHERE key='cleanup:v28-en'").get()) {
    const MORE = [['Nessun termine del settore: possibile omonimo', 'No industry term: possible namesake'], ['Social o sito non pertinente', 'Social or irrelevant site'], ['Contiene un termine escluso:', 'Contains an excluded word:'], ['Nome assente', 'Name missing'], ['Contesto: ', 'Context: '], ['Sito ufficiale', 'Official website'], ['Fiera di settore', 'Industry trade fair'], ['Nessun contesto definito', 'No context defined'], ['Web pubblico indicizzato', 'Indexed public web'], ['Pagina non leggibile: conservato l’estratto del motore.', 'Page not readable: search excerpt kept.'], ['Fonte non disponibile.', 'Source not available.']];
    rep('news', 'foundVia', MORE); rep('news', 'reviewReason', MORE);
    rep('runs', 'detail', [...VIA, ...MORE]);
    db.prepare("INSERT OR REPLACE INTO preferences(key,value) VALUES('cleanup:v28-en','true')").run();
  }
  // Pulizia una tantum: pubblicazioni e brevetti senza alcun legame tecnico, fiere senza anno.
  if (!db.prepare("SELECT 1 FROM preferences WHERE key='cleanup:v22'").get()) {
    for (const p of db.prepare('SELECT id,title,venue FROM publications').all()) if (!TECH.test(p.title + ' ' + p.venue)) db.prepare('DELETE FROM publications WHERE id=?').run(p.id);
    db.prepare("INSERT OR REPLACE INTO preferences(key,value) VALUES('cleanup:v22','true')").run();
  }
  if (!cols('companies').includes('excludeTerms')) db.exec("ALTER TABLE companies ADD COLUMN excludeTerms TEXT NOT NULL DEFAULT ''");
  if (!cols('companies').includes('products')) db.exec("ALTER TABLE companies ADD COLUMN products TEXT NOT NULL DEFAULT ''");
  if (!cols('companies').includes('watchEvents')) db.exec("ALTER TABLE companies ADD COLUMN watchEvents TEXT NOT NULL DEFAULT '[]'");
  if (!db.prepare("SELECT 1 FROM preferences WHERE key='cleanup:title-company-v1'").get()) {
    const mark = db.prepare("UPDATE news SET review=1,reviewReason='Company named only in the excerpt' WHERE id=? AND review=0");
    for (const n of db.prepare(`SELECT n.id,n.title,n.url,n.method,c.name,c.aliases,c.website FROM news n
      JOIN news_companies nc ON nc.newsId=n.id JOIN companies c ON c.id=nc.companyId WHERE n.method<>'manual'`).all()) {
      if (n.website && host(n.url) !== host(n.website) && !nameInTitle(n.title, { name: n.name, aliases: n.aliases })) mark.run(n.id);
    }
    db.prepare("INSERT INTO preferences(key,value) VALUES('cleanup:title-company-v1','true')").run();
  }
}

export function createIntel(store, { fetchFn, search, papers = searchPapers, patents = searchPatents, people = searchPeople, posts = searchPosts, facts = searchFacts } = {}) {
  const db = store.db;
  const learning = createLearning(db);
  const row = id => db.prepare('SELECT * FROM company_intel WHERE companyId=?').get(id);
  const intelOf = id => {
    const r = row(id);
    if (!r) return { profile: {}, terms: [], methods: [], errors: [], ai: null };
    return { ...r, profile: JSON.parse(r.profile), terms: JSON.parse(r.terms), methods: JSON.parse(r.methods), errors: JSON.parse(r.errors), ai: r.ai ? JSON.parse(r.ai) : null };
  };
  const saveIntel = (id, patch) => {
    const cur = intelOf(id);
    const next = { ...cur, ...patch };
    db.prepare(`INSERT INTO company_intel(companyId,profile,terms,methods,errors,ai,siteScannedAt,pubsScannedAt,fairsScannedAt) VALUES(?,?,?,?,?,?,?,?,?)
      ON CONFLICT(companyId) DO UPDATE SET profile=excluded.profile,terms=excluded.terms,methods=excluded.methods,errors=excluded.errors,ai=excluded.ai,siteScannedAt=excluded.siteScannedAt,pubsScannedAt=excluded.pubsScannedAt,fairsScannedAt=excluded.fairsScannedAt`)
      .run(id, JSON.stringify(next.profile || {}), JSON.stringify(next.terms || []), JSON.stringify(next.methods || []), JSON.stringify(next.errors || []), next.ai ? JSON.stringify(next.ai) : null, next.siteScannedAt || null, next.pubsScannedAt || null, next.fairsScannedAt || null);
  };

  // Termini che identificano l'azienda: parole chiave manuali, settore e termini ricavati dal sito.
  function terms(company) {
    const manual = String(company.keywords || '').split(/[,;]|\s+/).concat(String(company.sector || '').split(/[,;]|\s+/)).map(norm).filter(w => w.length >= 4);
    const own = new Set([company.name, ...(company.aliases || [])].flatMap(n => norm(n).split(/[^a-z0-9]+/)).filter(Boolean));
    return [...new Set([...manual, ...specificTerms(intelOf(company.id).terms)])].filter(w => !own.has(w) && ![...own].some(o => o.length >= 4 && w.includes(o)));
  }

  // Pertinenza di un risultato: accept / review (da verificare) / reject.
  const keyPeople = companyId => db.prepare("SELECT name FROM people WHERE companyId=? AND hidden=0 AND checked IN ('website','verified') LIMIT 80").all(companyId).map(r => r.name);
  function saveProfiles(companyId, items) {
    const now = new Date().toISOString();
    const up = db.prepare('INSERT INTO profiles(id,companyId,url,title,summary,source,firstSeen,lastSeen) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(companyId,url) DO UPDATE SET title=excluded.title,summary=excluded.summary,lastSeen=excluded.lastSeen');
    let n = 0; for (const i of items) { try { const u = new URL(i.url).href; n += up.run(createHash('sha256').update(companyId + u).digest('hex').slice(0, 32), companyId, u, String(i.title || '').slice(0, 300), String(i.summary || '').slice(0, 1500), host(u), now, now).changes; } catch {} }
    return n;
  }
  // Your decisions (sites always discarded or kept, articles like ones you discarded) adjust the rules below.
  function judge(item, company, nameMatches, opts = {}) { return learning.adjust(baseJudge(item, company, nameMatches, opts), item, company, nameMatches); }
  function baseJudge(item, company, nameMatches, { products = [] } = {}) {
    const text = norm(`${item.title} ${item.summary}`);
    if (/^(?:[a-z0-9-]+\.)?(?:x\.com|twitter\.com|youtube\.com|youtu\.be)$/.test(host(item.url))&&!publicMediaType(item.url))return {verdict:'reject',reason:'Not a public post or video'};
    if (isNoisy(item.url)) return { verdict: 'reject', reason: 'Social or irrelevant site' };
    if (!nameMatches) {const person=strongSignal(item, company, {people:keyPeople(company.id)});const related=terms(company).some(term=>text.includes(term));return person&&related?{verdict:'review',reason:'Associated person and industry context; company connection needs verification · '+person}:{verdict:'reject',reason:'Company name missing or associated person without industry context'};}
    const excluded = String(company.excludeTerms || '').split(',').map(norm).map(s => s.trim()).filter(Boolean);
    const hit = excluded.find(t => text.includes(t));
    if (hit) return { verdict: 'reject', reason: `Contains an excluded word: ${hit}` };
    if (isJunkSite(item.url)) return { verdict: 'reject', reason: 'People-search or website-statistics page' };
    // LinkedIn job postings are titled "<Company> hiring <role> in <place>": the employer is stated, so the company is certain.
    if (isJobPosting(item.url)) { const t = norm(item.title).trim(); if ([company.name, ...(company.aliases || [])].some(n => n && t.startsWith(norm(n) + ' hiring '))) return { verdict: 'accept', reason: 'Job opening published by the company' }; }
    if (isProfilePage(item.url)) return { verdict: 'profile', reason: 'Company directory or profile page' };
    if (company.website && host(item.url) === host(company.website)) return { verdict: 'accept', reason: 'Official website' };
    const old = probablyOld(item);
    // Strong proofs that it is really this company: its website address, one of its people, one of its products.
    const strong = strongSignal(item, company, { people: keyPeople(company.id), products });
    if (strong) return old ? { verdict: 'review', reason: `Probably old (mentions only years up to ${old}) · ${strong}` } : { verdict: 'accept', reason: strong };
    if (!nameInTitle(item.title, company) && !(products.length && mentionsProduct(item.title, products))) return { verdict: 'review', reason: 'Company named only in the excerpt' };
    if (old) return { verdict: 'review', reason: `Probably old: no date, mentions only years up to ${old}` };
    const t = terms(company);
    if (!t.length) return { verdict: 'accept', reason: 'No context defined' };
    const found = t.filter(w => text.includes(w));
    if (found.length) return { verdict: 'accept', reason: 'Context: ' + found.slice(0, 3).join(', ') };
    if (hasEventSignal(item.title) && matchCatalog(`${item.title} ${item.summary}`)) return { verdict: 'accept', reason: 'Industry trade fair' };
    return { verdict: 'review', reason: 'No industry term: possible namesake' };
  }

  function upsertEvent(companyId, ev, source, { official, baseline }) {
    if (!ev) return 0;
    const existing = db.prepare('SELECT * FROM events WHERE companyId=? AND fairKey=? AND year=?').get(companyId, ev.fairKey, ev.year || 0);
    if (existing) {
      const sameSource = existing.sourceUrl === source.url;
      db.prepare(`UPDATE events SET startDate=COALESCE(startDate,?),endDate=COALESCE(endDate,?),booth=COALESCE(booth,?),official=MAX(official,?),
        sourceUrl=CASE WHEN ?=1 AND official=0 THEN ? ELSE sourceUrl END,sourceTitle=CASE WHEN ?=1 AND official=0 THEN ? ELSE sourceTitle END,sources=sources+? WHERE id=?`)
        .run(ev.startDate, ev.endDate, ev.booth, official ? 1 : 0, official ? 1 : 0, source.url, official ? 1 : 0, source.title || '', sameSource ? 0 : 1, existing.id);
      return 0;
    }
    const upcoming = eventStatus(ev) === 'upcoming';
    db.prepare(`INSERT INTO events(id,companyId,fairKey,fairName,year,startDate,endDate,city,sector,booth,sourceUrl,sourceTitle,official,firstSeen,baseline) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(randomUUID(), companyId, ev.fairKey, ev.fairName, ev.year || 0, ev.startDate, ev.endDate, ev.city || '', ev.sector || '', ev.booth, source.url, String(source.title || '').slice(0, 500), official ? 1 : 0, now(), baseline && !upcoming ? 1 : 0);
    return 1;
  }

  // Riconosce partecipazioni a fiere nelle notizie raccolte.
  function eventsFromItems(items, company) {
    let added = 0;
    for (const item of items) {
      const ev = detectEvent(item);
      if (ev) added += upsertEvent(company.id, ev, item, { official: company.website && host(item.url) === host(company.website), baseline: false });
    }
    return added;
  }

  async function scanOfficialSite(company, { lookbackDays = 7, maxRead = 12, log = () => {} } = {}) {
    if (!company.website) return { newPages: 0, events: 0, errors: ['No official website: add it in the company card.'] };
    log('Official website · looking for API, feeds and sitemap');
    const result = await scanSite(company.website, { fetchFn });
    const first = !db.prepare('SELECT 1 FROM active_site_pages WHERE companyId=? LIMIT 1').get(company.id);
    const cutoff = Date.now() - Math.max(lookbackDays, 30) * DAY;
    const fresh = [];
    let newPages = 0;
    db.transaction(() => {
      for (const e of result.entries) {
        const id = hash(company.id + e.url);
        const prev = db.prepare('SELECT * FROM site_pages WHERE id=?').get(id);
        if (prev?.deletedAt) continue;
        if (prev) {
          const changed = e.lastmod && prev.lastmod && e.lastmod !== prev.lastmod;
          db.prepare('UPDATE site_pages SET title=CASE WHEN title=\'\' THEN ? ELSE title END,summary=CASE WHEN summary=\'\' THEN ? ELSE summary END,publishedAt=COALESCE(publishedAt,?),lastmod=COALESCE(?,lastmod),updatedAt=CASE WHEN ? THEN ? ELSE updatedAt END WHERE id=?')
            .run(e.title, e.summary, e.publishedAt, e.lastmod, changed ? 1 : 0, now(), id);
          continue;
        }
        const recent = (e.publishedAt && Date.parse(e.publishedAt) >= cutoff) || (e.lastmod && Date.parse(e.lastmod) >= Date.now() - lookbackDays * DAY && e.kind !== 'page');
        const baseline = first && !recent ? 1 : 0;
        db.prepare('INSERT INTO site_pages(id,companyId,url,title,summary,kind,via,publishedAt,lastmod,firstSeen,baseline) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
          .run(id, company.id, e.url, e.title, e.summary, e.kind, e.via, e.publishedAt, e.lastmod, now(), baseline);
        if (!baseline) newPages++;
        fresh.push({ ...e, id, baseline });
      }
    })();

    // Continue enriching previously collected sitemap entries as well as new pages.
    const pending = db.prepare("SELECT * FROM active_site_pages WHERE companyId=? AND (title='' OR title=url) AND url NOT LIKE '%.pdf' ORDER BY CASE kind WHEN 'news' THEN 0 WHEN 'event' THEN 1 WHEN 'product' THEN 2 ELSE 3 END, COALESCE(publishedAt,lastmod,firstSeen) DESC").all(company.id);
    const enrichmentCandidates = [...fresh.filter(e=>!e.baseline), ...pending];
    const toRead = [...new Map(enrichmentCandidates.map(e=>[e.id,e])).values()].slice(0,maxRead);
    for (const e of toRead) {
      log(`Official website · reading ${e.url}`);
      try {
        const page = await readPage(e.url, fetchFn);
        if (!page) continue;
        e.title = !e.title || e.title === e.url ? page.title : e.title; e.summary = (e.summary ? e.summary + ' ' : '') + page.summary; e.publishedAt = e.publishedAt || page.publishedAt;
        db.prepare('UPDATE site_pages SET title=?,summary=?,publishedAt=COALESCE(publishedAt,?),kind=CASE WHEN kind=\'page\' THEN ? ELSE kind END,image=?,lead=? WHERE id=?')
          .run(e.title, e.summary.slice(0, 6000), e.publishedAt, hasEventSignal(e.title) ? 'event' : 'page', page.image || '', page.lead || '', e.id);
      } catch (error) { if(error.status===429){log('Official website · rate limit reached; remaining titles will be retried on a later update.');break;} }
    }

    // Fiere annunciate dal sito ufficiale (anche lo storico, alla prima scansione).
    let events = 0;
    const candidates = db.prepare("SELECT * FROM active_site_pages WHERE companyId=? AND kind IN ('event','news','page') ").all(company.id);
    for (const p of candidates) {
      const ev = detectEvent({ title: p.title || slug(p.url), summary: p.summary, publishedAt: p.publishedAt, url: p.url });
      if (ev) events += upsertEvent(company.id, ev, { url: p.url, title: p.title }, { official: true, baseline: !!p.baseline });
    }
    const profile = result.profile;
    saveIntel(company.id, { profile, terms: contextTerms(profile), methods: result.methods, errors: result.errors, siteScannedAt: now() });
    return { newPages, events, errors: result.errors, methods: result.methods, total: result.entries.length, first };
  }

  async function searchFairs(company, { includeChinese = false, maxResults = 10, log = () => {} } = {}) {
    if (!search || !searchReady()) return { events: 0, items: [], errors: [] };
    const name = '"' + company.name.replaceAll('"', '') + '"', year = new Date().getFullYear();
    const queries = [
      `${name} booth OR stand OR hall exhibitor ${year}`,
      `${name} trade fair exhibition ${year} ${year + 1}`,
      `${name} fiera stand padiglione ${year}`,
    ];
    const chinese = company.aliases?.find(n => /\p{Script=Han}/u.test(n));
    if (includeChinese && chinese) queries.push(`"${chinese}" 展会 展位 ${year}`);
    const items = [], errors = [];
    let events = 0;
    for (const q of queries) {
      log(`Trade fairs · ${q}`);
      try {
        const found = await search(q, { topic: 'general', recent: false, maxResults });
        for (const r of found) {
          const { matchesCompany } = await import('../market-service.js');
          if (!matchesCompany(r, company) || isNoisy(r.url)) continue;
          const ev = detectEvent(r);
          if (!ev) continue;
          events += upsertEvent(company.id, ev, r, { official: company.website && host(r.url) === host(company.website), baseline: false });
          items.push({ ...r, query: q });
        }
      } catch (e) { errors.push(e.public ? e.message : 'Trade fair search failed.'); }
    }
    saveIntel(company.id, { fairsScannedAt: now() });
    return { events, items, errors };
  }

  async function scanPublications(company, { log = () => {} } = {}) {
    const first = !db.prepare('SELECT 1 FROM publications WHERE companyId=? LIMIT 1').get(company.id);
    const errors = [];
    let list = [];
    log('Scientific papers · OpenAlex');
    try { list = list.concat(await papers(company, { fetchFn: fetch })); } catch (e) { errors.push(e.public ? e.message : 'OpenAlex not reachable.'); }
    log('Patents');
    try { list = list.concat(await patents(company, { search })); } catch (e) { errors.push(e.public ? e.message : 'Patent search failed.'); }
    let added = 0;
    const t = terms(company);
    list = list.filter(p => TECH.test(`${p.title} ${p.venue}`) || t.some(w => norm(p.title).includes(w)));
    for (const p of list) {
      const recent = p.publishedAt && Date.parse(p.publishedAt) >= Date.now() - 60 * DAY;
      added += db.prepare('INSERT OR IGNORE INTO publications(id,companyId,kind,url,title,publishedAt,venue,authors,detail,firstSeen,baseline) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
        .run(hash(company.id + p.url), company.id, p.kind, p.url, p.title, p.publishedAt, p.venue || '', p.authors || '', p.detail || '', now(), first && !recent ? 1 : 0).changes;
    }
    saveIntel(company.id, { pubsScannedAt: now() });
    return { added, errors };
  }

  const meta = (id, k, v) => v === undefined ? store.pref(`meta:${id}:${k}`, null) : store.setPref(`meta:${id}:${k}`, v);

  // LinkedIn: persone (ogni 7 giorni) e post (a ogni aggiornamento), solo dai risultati di ricerca.
  async function scanSocial(company, { withPeople = true, log = () => {} } = {}) {
    const out = { people: 0, posts: 0, errors: [] };
    if (!search || !searchReady()) return out;
    if (withPeople) {
      log('LinkedIn · people');
      const firstPeople = !db.prepare('SELECT 1 FROM people WHERE companyId=? LIMIT 1').get(company.id);
      const r = await people(company, search); out.errors.push(...r.errors);
      const hiddenNames = new Set(db.prepare('SELECT name FROM people WHERE companyId=? AND hidden=1').all(company.id).map(x => norm(x.name)));
      for (const p of r.people) {
        if (!isPersonName(p.name) || hiddenNames.has(norm(p.name))) continue;
        const id = hash(company.id + p.url);
        if (db.prepare('SELECT 1 FROM people WHERE id=?').get(id)) { db.prepare("UPDATE people SET lastSeen=?,role=CASE WHEN query='added by you' THEN role WHEN ?<>'' THEN ? ELSE role END,location=CASE WHEN ?<>'' THEN ? ELSE location END WHERE id=?").run(now(), p.role, p.role, p.location, p.location, id); continue; }
        const leader = db.prepare("SELECT * FROM people WHERE companyId=? AND url LIKE '%linkedin.com/search/%'").all(company.id).find(x => norm(x.name) === norm(p.name));
        if (leader?.query === 'added by you') { db.prepare('UPDATE people SET url=?,lastSeen=? WHERE id=?').run(p.url, now(), leader.id); continue; }
        if (leader) db.prepare('DELETE FROM people WHERE id=?').run(leader.id);
        db.prepare('INSERT INTO people(id,companyId,name,role,location,url,current,snippet,query,firstSeen,lastSeen,baseline,source) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id, company.id, p.name, p.role || leader?.role || '', p.location, p.url, p.current === null ? null : p.current ? 1 : 0, p.snippet, p.query, now(), now(), firstPeople || leader ? 1 : 0, leader?.source || '');
        db.prepare('UPDATE people SET checked=? WHERE id=?').run(verifyPerson({ ...p, role: p.role || leader?.role || '' }, company), id);
        out.people++;
      }
      if (r.companyPage) meta(company.id, 'linkedin', r.companyPage);
      meta(company.id, 'peopleScannedAt', now());
    }
    log('LinkedIn · posts');
    const r = await posts(company, search); out.errors.push(...r.errors);
    const saved = store.ingest(r.posts.map(p => ({ url: p.url, title: p.title, summary: p.summary, publishedAt: p.publishedAt, category: 'social', lead: p.summary.slice(0, 600), foundVia: { label: 'LinkedIn post (from search engines)', query: p.query, engine: p.provider || activeProvider() || 'web', reason: p.fromCompany ? 'Posted by the company page' : 'Mentions the company' } })), company.id);
    out.posts = saved.added;
    return out;
  }

  async function scanFacts(company, { log = () => {}, web = true } = {}) {
    log('Key facts · archive and public sources');
    // Reuse only active sources already associated with the company and accepted news.
    const archived = [
      ...db.prepare('SELECT title,summary,url,publishedAt FROM active_site_pages WHERE companyId=?').all(company.id),
      ...db.prepare('SELECT n.title,n.summary,n.url,n.publishedAt FROM active_news n JOIN news_companies nc ON nc.newsId=n.id WHERE nc.companyId=? AND n.review=0').all(company.id)
    ].flatMap(row => extractFacts(row, company));
    const searched = web && search && searchReady();
    const r = searched ? await facts(company, search) : { facts: [], leaders: [], errors: [] };
    r.facts = [...archived, ...r.facts];
    let added = 0;
    const known = new Set(db.prepare('SELECT text FROM facts WHERE companyId=?').all(company.id).map(x => factKey(x.text)));
    for (const f of r.facts) { if (known.has(factKey(f.text))) continue; known.add(factKey(f.text)); added += db.prepare('INSERT OR IGNORE INTO facts(id,companyId,kind,text,url,source,publishedAt,firstSeen,year) VALUES(?,?,?,?,?,?,?,?,?)').run(hash(company.id + f.text), company.id, f.kind, f.text, f.url, f.source, f.publishedAt, now(), f.year).changes; }
    // Dirigenti citati nelle fonti: entrano tra le persone con il link per cercarli su LinkedIn.
    for (const l of r.leaders || []) {
      if (!isPersonName(l.name)) continue;
      // The source must really be about this company (not a namesake).
      if (judge({ url: l.sourceUrl || '', title: l.sourceTitle || '', summary: l.sourceText || '' }, company, true).verdict !== 'accept') continue;
      const existing = db.prepare('SELECT * FROM people WHERE companyId=?').all(company.id).find(p => norm(p.name) === norm(l.name));
      if (existing) { if (existing.hidden) continue; if (!existing.role) db.prepare('UPDATE people SET role=? WHERE id=?').run(l.role, existing.id); if (existing.checked !== 'website') db.prepare("UPDATE people SET checked='verified' WHERE id=?").run(existing.id); continue; }
      const url = 'https://www.linkedin.com/search/results/people/?keywords=' + encodeURIComponent(`${l.name} ${company.name}`);
      db.prepare('INSERT OR IGNORE INTO people(id,companyId,name,role,location,url,current,snippet,query,firstSeen,lastSeen,baseline,source) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(hash(company.id + url), company.id, l.name, l.role, '', url, null, '', 'executives quoted in sources', now(), now(), 1, l.sourceUrl || '');
      db.prepare("UPDATE people SET checked='verified' WHERE id=?").run(hash(company.id + url));
    }
    if (searched && !r.errors?.length) meta(company.id, 'factsScannedAt', now());
    return { added, errors: r.errors };
  }

  // Is a person found on LinkedIn really from this company? Listed on the website, or the profile mentions the website or specific industry words.
  function verifyPerson(p, company) {
    if (db.prepare("SELECT 1 FROM people WHERE companyId=? AND checked='website' AND lower(name)=lower(?)").get(company.id, p.name)) return 'website';
    const text = `${p.role || ''} ${p.snippet || ''} ${p.location || ''}`;
    if (strongSignal({ title: '', summary: text }, company)) return 'verified';
    const t = terms(company).filter(w => w.length >= 4);
    return t.some(w => norm(text).includes(w)) ? 'verified' : 'unverified';
  }
  const hidePerson = (id, hide = true) => { const p = db.prepare('SELECT * FROM people WHERE id=?').get(id); if (p) learning.record({ action: hide ? 'remove' : 'restore', kind: 'person', itemId: id, companyId: p.companyId, url: p.source || p.url, title: p.name }); return db.prepare('UPDATE people SET hidden=? WHERE id=?').run(hide ? 1 : 0, id).changes; };

  // People and history from the official website (home, About, Team, Leadership, History pages).
  async function scanTeam(company, { log = () => {} } = {}) {
    const out = { people: 0, facts: 0, pages: 0 };
    if (!company.website || !fetchFn) return out;
    log('Official website · people and history');
    const urls = db.prepare('SELECT url FROM active_site_pages WHERE companyId=?').all(company.id).map(r => r.url);
    const site = host(company.website);
    for (const url of teamPageCandidates(company.website, { urls, sections: intelOf(company.id).profile?.sections || [] })) {
      let lines;
      try {
        const r = await fetchFn(url, { maxBytes: 3 * 1024 * 1024, signal: AbortSignal.timeout(15000) });
        if (!r.ok || !/html/i.test(r.headers.get('content-type') || '') || host(r.url || url) !== site) continue;
        lines = pageLines(await r.text());
      } catch { continue; }
      out.pages++;
      for (const m of extractTeam(lines)) {
        const existing = db.prepare('SELECT * FROM people WHERE companyId=? AND lower(name)=lower(?)').all(company.id, m.name);
        if (existing.length) { for (const e of existing) db.prepare("UPDATE people SET checked='website',role=CASE WHEN role='' THEN ? ELSE role END,lastSeen=? WHERE id=?").run(m.role, now(), e.id); continue; }
        const id = hash(company.id + 'website:' + norm(m.name));
        out.people += db.prepare('INSERT OR IGNORE INTO people(id,companyId,name,role,location,url,current,snippet,query,firstSeen,lastSeen,baseline,source,checked) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
          .run(id, company.id, m.name, m.role, '', 'https://www.linkedin.com/search/results/people/?keywords=' + encodeURIComponent(`${m.name} ${company.name}`), 1, 'Listed on the official website', 'official website', now(), now(), 1, url, 'website').changes;
      }
      const known = new Set(db.prepare('SELECT text FROM facts WHERE companyId=?').all(company.id).map(x => factKey(x.text)));
      for (const sentence of extractHistory(lines).sentences) {
        if (known.has(factKey(sentence))) continue; known.add(factKey(sentence));
        const year = Number((sentence.match(/\b(1[89]\d\d|20[0-4]\d)\b/) || [])[1]) || null;
        out.facts += db.prepare('INSERT OR IGNORE INTO facts(id,companyId,kind,text,url,source,publishedAt,firstSeen,year) VALUES(?,?,?,?,?,?,?,?,?)').run(hash(company.id + sentence), company.id, 'history', sentence, url, site, null, now(), year).changes;
      }
    }
    // LinkedIn profiles are checked again against what the website says.
    for (const p of db.prepare("SELECT * FROM people WHERE companyId=? AND checked<>'website' AND query<>'added by you'").all(company.id)) db.prepare('UPDATE people SET checked=? WHERE id=?').run(verifyPerson(p, company), p.id);
    meta(company.id, 'teamScannedAt', now());
    return out;
  }

  // Applies the current relevance rules to the news already in the archive.
  function recheckAll() {
    let moved = 0, removed = 0, toReview = 0;
    const hasFts = db.prepare("SELECT 1 FROM sqlite_master WHERE name='news_fts'").get();
    const drop = (newsId, companyId) => {
      db.prepare('DELETE FROM news_companies WHERE newsId=? AND companyId=?').run(newsId, companyId);
      if (!db.prepare('SELECT 1 FROM news_companies WHERE newsId=?').get(newsId)) { if (hasFts) db.prepare('DELETE FROM news_fts WHERE id=?').run(newsId); db.prepare('DELETE FROM news WHERE id=?').run(newsId); }
    };
    db.transaction(() => {
      for (const c of store.companies()) {
        for (const p of db.prepare("SELECT * FROM people WHERE companyId=? AND checked=''").all(c.id)) db.prepare('UPDATE people SET checked=? WHERE id=?').run(verifyPerson(p, c), p.id);
        for (const n of db.prepare("SELECT n.* FROM active_news n JOIN news_companies nc ON nc.newsId=n.id WHERE nc.companyId=? AND n.review=0 AND n.category<>'social' AND n.starred=0").all(c.id)) {
          if (/Added by you|Feed RSS|LinkedIn post/i.test(n.foundVia || '')) continue;
          const j = judge(n, c, true);
          if (j.verdict === 'profile') { saveProfiles(c.id, [n]); drop(n.id, c.id); moved++; }
          else if (j.verdict === 'reject') { drop(n.id, c.id); removed++; }
          else if (j.verdict === 'review') { db.prepare('UPDATE news SET review=1,reviewReason=? WHERE id=?').run(j.reason, n.id); toReview++; }
        }
      }
    })();
    return { moved, removed, toReview };
  }

  // Scansione completa di un'azienda, rispettando le frequenze (sito ogni giorno, fiere e pubblicazioni ogni 7 giorni).
  async function scan(company, { force = false, lookbackDays = 7, includeChinese = false, log } = {}) {
    const info = intelOf(company.id), due = (v, days) => force || !v || Date.now() - Date.parse(v) >= days * DAY - 3600000;
    const out = { newPages: 0, events: 0, publications: 0, fairItems: [], errors: [], log: [] };
    try { const r = await scanOfficialSite(company, { lookbackDays, log }); out.newPages = r.newPages; out.events += r.events; out.errors.push(...r.errors); out.site = r; }
    catch (e) { out.errors.push('Official website not readable.'); }
    if (due(info.fairsScannedAt, 7)) { const r = await searchFairs(company, { includeChinese, log }); out.events += r.events; out.fairItems = r.items; out.errors.push(...r.errors); }
    if (due(info.pubsScannedAt, 7)) { const r = await scanPublications(company, { log }); out.publications = r.added; out.errors.push(...r.errors); }
    try { const r = await scanSocial(company, { withPeople: due(meta(company.id, 'peopleScannedAt'), 7), log }); out.people = r.people; out.posts = r.posts; out.errors.push(...r.errors); } catch { out.errors.push('LinkedIn search not completed.'); }
    if (due(meta(company.id, 'teamScannedAt'), 7)) { try { const r = await scanTeam(company, { log }); out.teamPeople = r.people; out.history = r.facts; } catch { out.errors.push('Team and history pages of the website not read.'); } }
    try { const r = await scanFacts(company, { log, web: due(meta(company.id, 'factsScannedAt'), 7) }); out.facts = r.added; out.errors.push(...r.errors); } catch { out.errors.push('Key facts search not completed.'); }
    return out;
  }

  // ---- Letture per l'interfaccia ----
  const companyName = id => store.company(id)?.name || '';
  const eventView = e => ({ ...e, official: !!e.official, baseline: !!e.baseline, hidden: !!e.hidden, status: eventStatus(e), companyName: companyName(e.companyId), typicalMonth: FAIR_CATALOG.find(f => f.key === e.fairKey)?.month || null });

  // Nasconde fiere senza anno e la voce generica quando esiste l'edizione specifica dello stesso anno.
  function visible(list) {
    const ok = list.filter(e => e.year > 0);
    return ok.filter(e => !(/not specified/.test(e.fairName) && ok.some(o => o !== e && o.companyId === e.companyId && o.year === e.year && o.fairKey.startsWith(e.fairKey + '-'))));
  }
  const parseVia = v => { try { return v ? JSON.parse(v) : null; } catch { return null; } };

  function dossier(id) {
    const c = store.company(id);
    if (!c) return null;
    const info = intelOf(id);
    const pages = kind => db.prepare(`SELECT id,url,title,summary,image,lead,kind,publishedAt,firstSeen,baseline,via FROM active_site_pages WHERE companyId=? AND kind=? ORDER BY COALESCE(publishedAt,lastmod,firstSeen) DESC LIMIT 40`).all(id, kind);
    const counts = Object.fromEntries(db.prepare('SELECT kind,COUNT(*) n FROM active_site_pages WHERE companyId=? GROUP BY kind').all(id).map(r => [r.kind, r.n]));
    return {
      company: c, manualEntries:store.entries?.list(id)||[], profile: info.profile, terms: terms(c), methods: info.methods, errors: info.errors, ai: info.ai,
      scannedAt: { site: info.siteScannedAt, publications: info.pubsScannedAt, fairs: info.fairsScannedAt },
      pageCounts: counts,
      publishing: { news: pages('news'), events: pages('event'), documents: pages('document'), careers: pages('career') },
      products: pages('product'),
      events: visible(db.prepare('SELECT * FROM events WHERE companyId=? AND hidden=0 ORDER BY year DESC, COALESCE(startDate,\'\') DESC').all(id).map(eventView)),
      people: db.prepare("SELECT * FROM people WHERE companyId=? AND hidden=0 ORDER BY CASE checked WHEN 'website' THEN 0 WHEN 'verified' THEN 1 ELSE 2 END, baseline ASC, firstSeen DESC, name").all(id),
      hiddenPeople: db.prepare('SELECT COUNT(*) n FROM people WHERE companyId=? AND hidden=1').get(id).n,
      linkedin: meta(id, 'linkedin'),
      facts: db.prepare('SELECT * FROM facts WHERE companyId=? AND hidden=0 ORDER BY kind, COALESCE(year,0) DESC').all(id),
      factLabels: FACT_LABELS,
      news: db.prepare("SELECT n.* FROM active_news n JOIN news_companies nc ON nc.newsId=n.id WHERE nc.companyId=? AND n.review=0 ORDER BY COALESCE(n.publishedAt,n.discoveredAt) DESC LIMIT 200").all(id).map(n => ({ ...n, foundVia: parseVia(n.foundVia), lead: n.aiSummary || n.lead || leadFromText(n.summary, [c.name]) })),
      monthly: db.prepare("SELECT substr(COALESCE(n.publishedAt,n.discoveredAt),1,7) m,COUNT(*) n FROM active_news n JOIN news_companies nc ON nc.newsId=n.id WHERE nc.companyId=? AND n.review=0 GROUP BY m ORDER BY m DESC LIMIT 12").all(id),
      scannedPeople: meta(id, 'peopleScannedAt'), scannedFacts: meta(id, 'factsScannedAt'),
      publications: db.prepare('SELECT * FROM publications WHERE companyId=? ORDER BY COALESCE(publishedAt,firstSeen) DESC LIMIT 60').all(id),
      profiles: db.prepare('SELECT * FROM profiles WHERE companyId=? ORDER BY lastSeen DESC LIMIT 60').all(id),
      review: db.prepare('SELECT n.* FROM active_news n JOIN news_companies nc ON nc.newsId=n.id WHERE nc.companyId=? AND n.review=1 ORDER BY n.discoveredAt DESC LIMIT 200').all(id).map(n=>({...n,foundVia:parseVia(n.foundVia)})),
    };
  }

  function radar({ days = 7, companies = '', types = '', day = '' } = {}) {
    let since = new Date(Date.now() - Math.min(Math.max(+days || 7, 1), 90) * DAY).toISOString(), until = '9999';
    if (day) { since = localDayStart(day); until = localDayStart(new Date(Date.parse(day + 'T12:00:00Z') + DAY).toISOString().slice(0, 10)); }
    const ids = String(companies).split(',').filter(Boolean);
    const want = new Set(String(types).split(',').filter(Boolean));
    const inCo = col => ids.length ? ` AND ${col} IN (${ids.map(() => '?').join(',')})` : '';
    const items = [];
    if (!want.size || want.has('site')) {
      for (const p of db.prepare(`SELECT * FROM active_site_pages WHERE baseline=0 AND firstSeen>=? AND firstSeen<?${inCo('companyId')}`).all(since, until, ...ids))
        items.push({ type: 'site', subtype: p.kind, id: p.id, companyId: p.companyId, title: p.title || safePath(p.url), url: p.url, at: p.firstSeen, publishedAt: p.publishedAt, detail: String(p.summary || '').slice(0, 400), image: p.image, lead: p.lead || leadFromText(p.summary) });
      for (const p of db.prepare(`SELECT * FROM active_site_pages WHERE updatedAt>=? AND updatedAt<? AND kind IN ('product','document')${inCo('companyId')}`).all(since, until, ...ids))
        items.push({ type: 'site', subtype: 'updated', id: p.id, companyId: p.companyId, title: p.title || p.url, url: p.url, at: p.updatedAt, publishedAt: p.lastmod, detail: 'Page modified by the company', image: p.image, lead: p.lead || 'Page modified by the company.' });
    }
    if (!want.size || want.has('event'))
      for (const e of db.prepare(`SELECT * FROM events WHERE baseline=0 AND hidden=0 AND firstSeen>=? AND firstSeen<?${inCo('companyId')}`).all(since, until, ...ids).map(eventView))
        items.push({ type: 'event', companyId: e.companyId, title: `${e.fairName}${e.year ? ' ' + e.year : ''}`, url: e.sourceUrl, at: e.firstSeen, publishedAt: e.startDate, detail: [e.booth, e.city, e.startDate && (e.startDate + (e.endDate && e.endDate !== e.startDate ? ' → ' + e.endDate : ''))].filter(Boolean).join(' · '), event: e, image: db.prepare('SELECT image FROM active_site_pages WHERE companyId=? AND url=?').get(e.companyId, e.sourceUrl)?.image || db.prepare('SELECT image FROM active_news WHERE url=?').get(e.sourceUrl)?.image || '', lead: db.prepare('SELECT lead FROM active_site_pages WHERE companyId=? AND url=?').get(e.companyId, e.sourceUrl)?.lead || '' });
    // Nel Daily entrano solo articoli con data di pubblicazione recente (al massimo 30 giorni prima del periodo):
    // un articolo trovato oggi ma pubblicato anni fa, o senza data, resta nell'Archivio.
    const fresh = new Date(Date.parse(since) - 30 * DAY).toISOString();
    const skipped = { old: 0, undated: 0 };
    if (!want.size || want.has('news'))
      for (const n of db.prepare(`SELECT n.*,nc.companyId FROM active_news n JOIN news_companies nc ON nc.newsId=n.id WHERE n.review=0 AND n.discoveredAt>=? AND n.discoveredAt<?${inCo('nc.companyId')}`).all(since, until, ...ids)) {
        if (!n.publishedAt) { skipped.undated++; continue; }
        if (n.publishedAt < fresh) { skipped.old++; continue; }
        items.push({ type: 'news', subtype: n.category, id: n.id, companyId: n.companyId, title: n.title, url: n.url, at: n.discoveredAt, publishedAt: n.publishedAt, detail: String(n.aiSummary || n.summary || '').slice(0, 400), source: n.source, newsId: n.id, foundVia: parseVia(n.foundVia), image: n.image, lead: n.aiSummary || n.lead || leadFromText(n.summary, [companyName(n.companyId)]), aiLead: !!n.aiSummary, dateHow: n.dateHow });
      }
    if (!want.size || want.has('people'))
      for (const p of db.prepare(`SELECT * FROM people WHERE baseline=0 AND hidden=0 AND firstSeen>=? AND firstSeen<?${inCo('companyId')}`).all(since, until, ...ids))
        items.push({ type: 'people', id: p.id, companyId: p.companyId, title: p.name + (p.role ? ' — ' + p.role : ''), url: p.url, at: p.firstSeen, publishedAt: null, image: '', lead: [p.location, p.snippet].filter(Boolean).join(' · ').slice(0, 400), foundVia: { label: 'LinkedIn profile (from search engines)', query: p.query } });
    if (!want.size || want.has('publication'))
      for (const p of db.prepare(`SELECT * FROM publications WHERE baseline=0 AND firstSeen>=? AND firstSeen<?${inCo('companyId')}`).all(since, until, ...ids))
        items.push({ type: 'publication', subtype: p.kind, id: p.id, companyId: p.companyId, title: p.title, url: p.url, at: p.firstSeen, publishedAt: p.publishedAt, detail: [p.venue, p.authors].filter(Boolean).join(' · '), image: '', lead: [p.venue && `Published in ${p.venue.replace(/\.$/, '')}.`, p.authors && `Authors linked to the company: ${p.authors}.`, p.detail].filter(Boolean).join(' ').slice(0, 500) });
    items.forEach(i => { i.companyName = companyName(i.companyId); });
    items.sort((a, b) => b.at.localeCompare(a.at));
    const review = db.prepare(`SELECT COUNT(DISTINCT n.id) n FROM active_news n JOIN news_companies nc ON nc.newsId=n.id WHERE n.review=1${inCo('nc.companyId')}`).get(...ids).n;
    const count = t => items.filter(i => i.type === t).length;
    return { since, skipped, items: items.slice(0, 500), counts: { site: count('site'), event: count('event'), news: count('news'), publication: count('publication') }, review };
  }

  function fairsBoard() {
    const all = visible(db.prepare('SELECT * FROM events WHERE hidden=0').all().map(eventView));
    const byFair = new Map();
    for (const e of all) {
      const key = e.fairKey.startsWith('other:') ? e.fairKey : e.fairKey;
      if (!byFair.has(key)) byFair.set(key, { fairKey: key, fairName: e.fairName, city: e.city, sector: e.sector, typicalMonth: e.typicalMonth, editions: {} });
      const f = byFair.get(key);
      (f.editions[e.year || 0] ||= []).push(e);
    }
    const today = new Date().toISOString().slice(0, 10);
    return {
      upcoming: all.filter(e => e.status === 'upcoming').sort((a, b) => (a.startDate || a.year + '-' + String(a.typicalMonth || 12).padStart(2, '0')).localeCompare(b.startDate || b.year + '-' + String(b.typicalMonth || 12).padStart(2, '0'))),
      recent: all.filter(e => e.status !== 'upcoming').sort((a, b) => (b.startDate || String(b.year)).localeCompare(a.startDate || String(a.year))).slice(0, 80),
      fairs: [...byFair.values()].sort((a, b) => Object.values(b.editions).flat().length - Object.values(a.editions).flat().length),
      catalog: FAIR_CATALOG.map(({ pattern, ...f }) => f),
      today,
    };
  }

  // Rassegna di un giorno: elementi del radar raggruppati per azienda.
  const dayItems = day => radar({ day }).items;
  const daySkipped = day => radar({ day }).skipped;
  function dailyFeed(day) {
    const days = new Set();
    const since = new Date(Date.now() - 90 * DAY).toISOString();
    const add = rows => rows.forEach(r => days.add(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(r.at))));
    add(db.prepare('SELECT discoveredAt at FROM active_news WHERE review=0 AND discoveredAt>=?').all(since));
    add(db.prepare('SELECT firstSeen at FROM active_site_pages WHERE baseline=0 AND firstSeen>=?').all(since));
    add(db.prepare('SELECT firstSeen at FROM events WHERE baseline=0 AND hidden=0 AND firstSeen>=?').all(since));
    add(db.prepare('SELECT firstSeen at FROM publications WHERE baseline=0 AND firstSeen>=?').all(since));
    const list = [...days].sort().reverse();
    const chosen = day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : list[0];
    if (!chosen) return { days: [], day: null, companies: [] };
    const raw = dayItems(chosen);
    const eventUrls = new Set(raw.filter(i => i.type === 'event').map(i => i.url));
    const items = raw.filter(i => !(i.type === 'site' && eventUrls.has(i.url)) && !(i.type === 'event' && !(i.event.year > 0)));
    const groups = new Map();
    for (const i of items) { if (!groups.has(i.companyId)) groups.set(i.companyId, { id: i.companyId, name: i.companyName, items: [] }); groups.get(i.companyId).items.push(i); }
    const order = { event: 0, site: 1, news: 2, people: 3, publication: 4 };
    const companies = [...groups.values()].map(g => ({ ...g, items: g.items.sort((a, b) => order[a.type] - order[b.type] || b.at.localeCompare(a.at)), counts: Object.fromEntries(['site', 'event', 'news', 'people', 'publication'].map(t => [t, g.items.filter(i => i.type === t).length])) }))
      .sort((a, b) => b.items.length - a.items.length);
    return { days: list.map(d => ({ day: d })), day: chosen, total: items.length, skipped: daySkipped(chosen), companies, missingPreviews: items.filter(i => (i.type === 'news' || i.type === 'site') && (!i.image || !i.lead) && !/\.pdf(\?|$)/i.test(i.url)).length };
  }
  // Daily: tutte le novità mescolate, ordinate per data di pubblicazione (o di comparsa, per pagine e profili).
  const safePath = u => { try { const slug=new URL(u).pathname.split('/').filter(Boolean).pop()||new URL(u).hostname;return decodeURIComponent(slug).replace(/[-_]+/g,' ').replace(/\.(html?|pdf)$/i,''); } catch { return 'Page title unavailable'; } };
  const pageLead = (p, name) => p.lead || leadFromText(p.summary) || 'Preview unavailable. Open the original source to read its contents.';
  const eventLead = e => [`${companyName(e.companyId)} is listed for ${e.fairName}${e.year ? ' ' + e.year : ''}.`, [e.booth, e.city, e.startDate && `Dates: ${e.startDate}${e.endDate && e.endDate !== e.startDate ? ' to ' + e.endDate : ''}.`].filter(Boolean).join(' · ')].filter(Boolean).join(' ');
  function sectorKeys(sector) { return sector ? new Set(db.prepare("SELECT kind||':'||itemId k FROM item_sectors WHERE sectorId=?").all(sector).map(r => r.k)) : null; }
  function sectorLabels() { const out = {}; for (const r of db.prepare("SELECT DISTINCT i.kind||':'||i.itemId k,s.id,s.name FROM item_sectors i JOIN sectors s ON s.id=i.sectorId").all()) (out[r.k] ||= []).push({ id: r.id, name: r.name }); return out; }
  function feed({ days = 30, companies = '', types = '', sector = '' } = {}) {
    const inSector = sectorKeys(sector), tags = sectorLabels();
    const span = [7, 30, 90].includes(+days) ? +days : 30;
    const until=new Date().toISOString(), since = new Date(Date.now() - span * DAY).toISOString(), recent = new Date(Date.now() - DAY).toISOString();
    const ids = String(companies).split(',').filter(Boolean), want = new Set(String(types).split(',').filter(Boolean));
    const inCo = col => ids.length ? ` AND ${col} IN (${ids.map(() => '?').join(',')})` : '';
    const hidden = new Set(db.prepare('SELECT kind||\':\'||itemId k FROM daily_hidden').all().map(r => r.k));
    const items = [];
    const seenNews = new Map();
    const push = i => { if (hidden.has(i.type + ':' + i.id)) return; if (inSector && !inSector.has(i.type + ':' + i.id)) return; i.sectors = tags[i.type + ':' + i.id] || []; if (i.type === 'news') { const prev = seenNews.get(i.id); if (prev) { prev.otherCompanies = [...(prev.otherCompanies || []), companyName(i.companyId)]; return; } seenNews.set(i.id, i); } i.companyName = companyName(i.companyId); i.sort = i.publishedAt || i.event?.startDate || i.at; i.isNew = i.at >= recent; items.push(i); };
      for (const n of db.prepare(`SELECT n.*,nc.companyId FROM active_news n JOIN news_companies nc ON nc.newsId=n.id WHERE n.review=0 AND n.publishedAt>=? AND n.publishedAt<=?${inCo('nc.companyId')}`).all(since, until, ...ids))
        push({ type: 'news', subtype: n.category, id: n.id, companyId: n.companyId, title: n.title, url: n.url, at: n.discoveredAt, publishedAt: n.publishedAt, source: n.source, foundVia: parseVia(n.foundVia), image: n.image, lead: n.aiSummary || n.lead || leadFromText(n.summary, [companyName(n.companyId)]), aiLead: !!n.aiSummary, dateHow: n.dateHow, notes: n.notes });
      for (const p of db.prepare(`SELECT * FROM active_site_pages WHERE baseline=0 AND kind<>'event' AND publishedAt>=? AND publishedAt<=?${inCo('companyId')}`).all(since, until, ...ids))
        push({ type: 'site', subtype: p.kind, id: p.id, companyId: p.companyId, title: p.title || safePath(p.url), url: p.url, at: p.firstSeen, publishedAt: p.publishedAt, image: p.image, lead: pageLead(p, companyName(p.companyId)) });
      for (const e of visible(db.prepare(`SELECT * FROM events WHERE baseline=0 AND hidden=0 AND startDate>=? AND startDate<=?${inCo('companyId')}`).all(since, until, ...ids).map(eventView)))
        push({ type: 'event', id: e.id, companyId: e.companyId, title: `${e.fairName} ${e.year}`, url: e.sourceUrl, at: e.firstSeen, publishedAt: null, event: e, image: db.prepare('SELECT image FROM active_site_pages WHERE companyId=? AND url=?').get(e.companyId, e.sourceUrl)?.image || '', lead: db.prepare('SELECT lead FROM active_site_pages WHERE companyId=? AND url=?').get(e.companyId, e.sourceUrl)?.lead || eventLead(e) });
      for (const p of db.prepare(`SELECT * FROM people WHERE baseline=0 AND hidden=0 AND firstSeen>=?${inCo('companyId')}`).all(since, ...ids))
        push({ type: 'people', id: p.id, companyId: p.companyId, title: p.name + (p.role ? ' — ' + p.role : ''), url: p.url, at: p.firstSeen, publishedAt: null, image: '', lead: [p.location, p.snippet].filter(Boolean).join(' · ').slice(0, 400), foundVia: { label: 'LinkedIn profile (from search engines)', query: p.query } });
      for (const p of db.prepare(`SELECT * FROM publications WHERE publishedAt>=? AND publishedAt<=?${inCo('companyId')}`).all(since, until, ...ids))
        push({ type: 'publication', subtype: p.kind, id: p.id, companyId: p.companyId, title: p.title, url: p.url, at: p.firstSeen, publishedAt: p.publishedAt, image: '', lead: [p.venue && `Published in ${p.venue.replace(/\.$/, '')}.`, p.authors && `Authors linked to the company: ${p.authors}.`, p.detail].filter(Boolean).join(' ').slice(0, 500) });
    // Le pagine del sito che annunciano una fiera compaiono una volta sola (come fiera).
    const eventUrls = new Set(items.filter(i => i.type === 'event').map(i => i.url));
    const list = items.filter(i => !(i.type === 'site' && eventUrls.has(i.url))).sort((a, b) => b.sort.localeCompare(a.sort));
    const selected=want.size?list.filter(i=>want.has(i.type)):list;
    const undated = db.prepare(`SELECT COUNT(DISTINCT n.id) n FROM active_news n JOIN news_companies nc ON nc.newsId=n.id WHERE n.review=0 AND n.publishedAt IS NULL${inCo('nc.companyId')}`).get(...ids).n;
    const count = t => list.filter(i => i.type === t).length;
    return { days: span, items: selected.slice(0, 400), counts: { news: count('news'), site: count('site'), event: count('event'), people: count('people'), publication: count('publication') }, newCount: selected.filter(i => i.isNew).length, hiddenCount: hidden.size, undated, missingPreviews: selected.filter(i => (i.type === 'news' || i.type === 'site') && (!i.image || !i.lead) && !/\.pdf(\?|$)/i.test(i.url)).length };
  }
  // Signal Center: strategic moves dated inside the period (event or publication date, never just
  // "found today"), without low-confidence items, hidden items or duplicates; articles about the
  // same event are grouped and counted as confirming sources.
  function signals({ days = 30, companies = '', sector = '' } = {}) {
    const inSector = sectorKeys(sector), tags = sectorLabels();
    const sectorWatch = sector ? JSON.parse(db.prepare('SELECT watch FROM sectors WHERE id=?').get(sector)?.watch || '[]') : [];
    const span = [7, 30, 90].includes(+days) ? +days : 30;
    const since = new Date(Date.now() - span * DAY).toISOString(), recent = new Date(Date.now() - DAY).toISOString(), until = new Date(Date.now() + DAY).toISOString();
    const ids = String(companies).split(',').filter(Boolean);
    const filter = ids.length ? ` AND nc.companyId IN (${ids.map(() => '?').join(',')})` : '';
    const hidden = new Set(db.prepare("SELECT itemId FROM daily_hidden WHERE kind='news'").all().map(r => r.itemId));
    const rows = db.prepare(`SELECT n.*,nc.companyId,c.name companyName,c.aliases companyAliases,c.watchEvents FROM active_news n
      JOIN news_companies nc ON nc.newsId=n.id JOIN companies c ON c.id=nc.companyId
      WHERE n.review=0 AND n.eventType<>'' AND n.confidence IN ('high','medium')
      AND COALESCE(n.eventDate,n.publishedAt)>=? AND COALESCE(n.eventDate,n.publishedAt)<=?${filter}
      ORDER BY (n.evidence='primary') DESC, (n.eventDate IS NOT NULL) DESC, COALESCE(n.eventDate,n.publishedAt) ASC`).all(since, until, ...ids)
      .filter(n => !hidden.has(n.id) && (!inSector || inSector.has('news:' + n.id)));
    const byId = new Map(), groups = [];
    for (const n of rows) {
      if (byId.has(n.id)) { const g = byId.get(n.id); if (!g.otherCompanies.includes(n.companyName) && g.companyName !== n.companyName) g.otherCompanies.push(n.companyName); continue; }
      const names = [n.companyName, ...JSON.parse(n.companyAliases || '[]')];
      const g = groups.find(x => x.companyId === n.companyId && x.eventType === n.eventType && x.members.some(m => sameEvent(m.title, n.title, { companyNames: names })));
      const member = { id: n.id, title: n.title, url: n.url, source: n.source, evidence: n.evidence, date: n.eventDate || n.publishedAt, discoveredAt: n.discoveredAt, eventBy: n.eventBy };
      if (g) { g.members.push(member); byId.set(n.id, g); continue; }
      const watch = JSON.parse(n.watchEvents || '[]');
      const item = { id: n.id, companyId: n.companyId, companyName: n.companyName, otherCompanies: [], eventType: n.eventType, title: n.title, url: n.url, source: n.source,
        eventDate: n.eventDate, eventDateKind: n.eventDateKind, publishedAt: n.publishedAt, discoveredAt: n.discoveredAt, evidence: n.evidence, confidence: n.confidence, eventBy: n.eventBy,
        lead: n.aiSummary || n.lead || leadFromText(n.summary, [n.companyName]), priority: watch.includes(n.eventType) || sectorWatch.includes(n.eventType), sectors: tags['news:' + n.id] || [], members: [member] };
      groups.push(item); byId.set(n.id, item);
    }
    const items = groups.map(g => {
      const hosts = new Set(g.members.map(m => m.source));
      const primary = g.members.some(m => m.evidence === 'primary'), byYou = g.members.some(m => m.eventBy === 'you');
      const first = g.members.map(m => m.date).filter(Boolean).sort()[0] || g.publishedAt;
      const eventDate = g.eventDate || g.members.map(m => rows.find(r => r.id === m.id)?.eventDate).find(Boolean) || null;
      return { ...g, eventDate, sources: hosts.size, evidence: primary ? 'primary' : g.evidence, confidence: primary || byYou || hosts.size >= 2 ? 'high' : 'medium',
        status: byYou ? 'checked by you' : primary || hosts.size >= 2 ? 'confirmed' : 'to verify', firstDate: first, kind: 'news',
        isNew: g.members.some(m => (m.discoveredAt || '') >= recent),
        others: g.members.slice(1).slice(0, 6) };
    });
    // Changes on the key pages you watch (catalogue, price list…).
    const hiddenChanges = new Set(db.prepare("SELECT itemId FROM daily_hidden WHERE kind='change'").all().map(r => r.itemId));
    for (const ch of db.prepare(`SELECT c.*,p.url,p.label,co.name companyName,co.watchEvents FROM key_page_changes c JOIN key_pages p ON p.id=c.pageId JOIN companies co ON co.id=c.companyId WHERE c.detectedAt>=?${ids.length ? ` AND c.companyId IN (${ids.map(() => '?').join(',')})` : ''} ORDER BY c.detectedAt DESC`).all(since, ...ids)) {
      if (hiddenChanges.has(ch.id) || (inSector && !inSector.has('change:' + ch.id))) continue;
      const added = JSON.parse(ch.added), removed = JSON.parse(ch.removed);
      let source = ''; try { source = new URL(ch.url).hostname.replace(/^www\./, ''); } catch {}
      items.push({ id: ch.id, kind: 'change', companyId: ch.companyId, companyName: ch.companyName, otherCompanies: [], eventType: 'page_change', title: `${ch.label || 'Watched page'} changed`, url: ch.url, source,
        eventDate: ch.detectedAt, eventDateKind: 'change detected by EMMA', publishedAt: ch.detectedAt, discoveredAt: ch.detectedAt, firstDate: ch.detectedAt, evidence: 'primary', confidence: 'high', status: 'confirmed', sources: 1,
        priority: JSON.parse(ch.watchEvents || '[]').includes('page_change'), isNew: ch.detectedAt >= recent, members: [], others: [], change: { added: added.slice(0, 8), removed: removed.slice(0, 8), addedCount: added.length, removedCount: removed.length } });
    }
    items.sort((a, b) => Number(b.priority) - Number(a.priority) || String(b.eventDate || b.firstDate || '').localeCompare(String(a.eventDate || a.firstDate || '')));
    return { days: span, items: items.slice(0, 80), total: items.length, newCount: items.filter(i => i.isNew).length, priorityCount: items.filter(i => i.priority).length };
  }
  function hideFromDaily(kind, id, hide = true) {
    if (!['news', 'site', 'event', 'people', 'publication', 'change'].includes(kind)) return 0;
    return hide ? db.prepare('INSERT OR REPLACE INTO daily_hidden(kind,itemId,hiddenAt) VALUES(?,?,?)').run(kind, id, now()).changes : db.prepare('DELETE FROM daily_hidden WHERE kind=? AND itemId=?').run(kind, id).changes;
  }

  function savePreview(item, { image, lead }) {
    const img = /^https?:\/\//i.test(image || '') ? image.slice(0, 1000) : '';
    if (item.type === 'news') return db.prepare("UPDATE news SET image=CASE WHEN ?<>'' THEN ? ELSE image END,lead=CASE WHEN ?<>'' THEN ? ELSE lead END WHERE id=?").run(img, img, lead || '', String(lead || '').slice(0, 800), item.id).changes;
    return db.prepare("UPDATE site_pages SET image=CASE WHEN ?<>'' THEN ? ELSE image END,lead=CASE WHEN ?<>'' THEN ? ELSE lead END WHERE id=?").run(img, img, lead || '', String(lead || '').slice(0, 800), item.id).changes;
  }

  function compare(ids, days = 30) {
    const span = [30, 90].includes(Number(days)) ? Number(days) : 30;
    const year = new Date().getFullYear(), since = new Date(Date.now() - span * DAY).toISOString();
    const columns = ids.map(id => {
      const c = store.company(id); if (!c) return null;
      const one = (sql, ...a) => db.prepare(sql).get(id, ...a).n;
      const ev = visible(db.prepare('SELECT * FROM events WHERE companyId=? AND hidden=0').all(id).map(eventView));
      const facts = db.prepare('SELECT kind,text,url,source,year FROM facts WHERE companyId=? AND hidden=0 ORDER BY COALESCE(year,0) DESC').all(id);
      return {
        company: c, description: c.description || intelOf(id).ai?.summary || intelOf(id).profile?.description || '',
        sections: (intelOf(id).profile?.sections || []).map(s => s.label).slice(0, 12),
        site: { pages: one('SELECT COUNT(*) n FROM active_site_pages WHERE companyId=?'), products: one("SELECT COUNT(*) n FROM active_site_pages WHERE companyId=? AND kind='product'"), documents: one("SELECT COUNT(*) n FROM active_site_pages WHERE companyId=? AND kind='document'"), newPages: one('SELECT COUNT(*) n FROM active_site_pages WHERE companyId=? AND baseline=0 AND firstSeen>=?', since) },
        news: one('SELECT COUNT(*) n FROM active_news n JOIN news_companies nc ON nc.newsId=n.id WHERE nc.companyId=? AND n.review=0 AND n.discoveredAt>=?', since),
        strategic: Object.fromEntries(db.prepare("SELECT n.eventType type,COUNT(*) n FROM active_news n JOIN news_companies nc ON nc.newsId=n.id WHERE nc.companyId=? AND n.review=0 AND n.eventType<>'' AND n.confidence IN ('high','medium') AND COALESCE(n.eventDate,n.publishedAt)>=? GROUP BY n.eventType").all(id, since).map(r => [r.type, r.n])),
        posts: one("SELECT COUNT(*) n FROM active_news n JOIN news_companies nc ON nc.newsId=n.id WHERE nc.companyId=? AND n.category='social'"),
        people: one('SELECT COUNT(*) n FROM people WHERE companyId=? AND hidden=0'),
        roles: db.prepare("SELECT role FROM people WHERE companyId=? AND hidden=0 AND role<>''").all(id).map(r => r.role).slice(0, 8),
        linkedin: meta(id, 'linkedin'),
        papers: one("SELECT COUNT(*) n FROM publications WHERE companyId=? AND kind='paper'"), patents: one("SELECT COUNT(*) n FROM publications WHERE companyId=? AND kind='patent'"),
        fairs: { thisYear: ev.filter(e => e.year === year).map(e => e.fairName), upcoming: ev.filter(e => e.status === 'upcoming').map(e => `${e.fairName} ${e.year}`), total: ev.length },
        facts: Object.fromEntries(Object.keys(FACT_LABELS).map(k => [k, facts.filter(f => f.kind === k).slice(0, 2)])),
        latest: db.prepare("SELECT n.title,n.url,n.source,n.publishedAt,n.discoveredAt FROM active_news n JOIN news_companies nc ON nc.newsId=n.id WHERE nc.companyId=? AND n.review=0 ORDER BY n.discoveredAt DESC LIMIT 4").all(id),
      };
    }).filter(Boolean);
    const fairRows = new Map();
    for (const e of visible(db.prepare(`SELECT * FROM events WHERE hidden=0 AND companyId IN (${ids.map(() => '?').join(',') || "''"})`).all(...ids).map(eventView))) {
      if (!fairRows.has(e.fairName)) fairRows.set(e.fairName, { fairName: e.fairName, sector: e.sector, cells: {} });
      (fairRows.get(e.fairName).cells[e.companyId] ||= []).push(e.year);
    }
    return { days: span, columns, factLabels: FACT_LABELS, fairs: [...fairRows.values()].sort((a, b) => Object.keys(b.cells).length - Object.keys(a.cells).length) };
  }

  function hideEvent(id) { return db.prepare('UPDATE events SET hidden=1 WHERE id=?').run(id).changes; }
  function resolveReview(id, accept) {
    const n = db.prepare('SELECT * FROM news WHERE id=?').get(id); if (!n) return 0;
    const label = (() => { try { return JSON.parse(n.foundVia || '{}').label || ''; } catch { return ''; } })();
    for (const r of db.prepare('SELECT companyId FROM news_companies WHERE newsId=?').all(id)) learning.record({ action: accept ? 'keep' : 'discard', itemId: id, companyId: r.companyId, url: n.url, label, title: n.title });
    if (accept) return db.prepare('UPDATE news SET review=0,reviewReason=\'\' WHERE id=?').run(id).changes;
    // Discarded articles stay in the bin, so the same address is never proposed again.
    return db.prepare('UPDATE news SET deletedAt=? WHERE id=?').run(now(), id).changes;
  }
  // Your other decisions on articles: kept (starred, added by you), deleted, restored.
  function learnFromNews(id, action) {
    const n = db.prepare('SELECT * FROM news WHERE id=?').get(id); if (!n) return;
    const label = (() => { try { return JSON.parse(n.foundVia || '{}').label || ''; } catch { return ''; } })();
    const companies = db.prepare('SELECT companyId FROM news_companies WHERE newsId=?').all(id);
    if (action === 'restore') return learning.record({ action, itemId: id });
    for (const r of companies.length ? companies : [{ companyId: '' }]) learning.record({ action, itemId: id, companyId: r.companyId, url: n.url, label, title: n.title });
  }

  return { learning, learnFromNews, saveProfiles, scanTeam, hidePerson, verifyPerson, recheckAll, feed, signals, hideFromDaily, compare, scanSocial, scanFacts, dayItems, dailyFeed, savePreview, scan, scanOfficialSite, searchFairs, scanPublications, judge, terms, eventsFromItems, dossier, radar, fairsBoard, hideEvent, resolveReview, intelOf, saveIntel };
}
