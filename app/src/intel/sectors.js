// Sectors: a working lens over the companies already in EMMA. A sector says
// which words, applications and companies matter for one market; EMMA then
// labels every item that really talks about that market, so the Daily, the
// Archive and Compare can show only what is relevant. Rules only, no AI:
// an item belongs to a sector when it comes from one of the sector's
// companies, contains no excluded word, and names a sector term in the title
// (or address), or at least two different sector terms in the text.
import { randomUUID } from 'node:crypto';

export const SECTOR_AREAS = {
  offer: { label: 'Offer', looks: 'Product pages, catalogues, datasheets, launches' },
  technology: { label: 'Technology', looks: 'Patents, papers, materials, specifications, research' },
  production: { label: 'Production', looks: 'New plants, lines, capacity, investments' },
  market: { label: 'Market', looks: 'Countries, distributors, declared customers, partnerships' },
  compliance: { label: 'Compliance', looks: 'Certifications, tests, regulations' },
  organisation: { label: 'People', looks: 'Appointments, hiring' },
  visibility: { label: 'Visibility', looks: 'Trade fairs, events, press releases, news' },
};
const AREA_OF_EVENT = { product_launch: 'offer', patent: 'technology', capacity_investment: 'production', funding: 'production', market_expansion: 'market', partnership: 'market', pricing: 'market', certification: 'compliance', leadership: 'organisation', hiring: 'organisation' };

const norm = s => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
const list = v => [...new Set((Array.isArray(v) ? v : String(v || '').split(/[,;\n]/)).map(x => String(x).trim()).filter(x => x.length >= 2))].slice(0, 60);
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const termRe = t => new RegExp(`(^|[^a-z0-9])${escapeRe(norm(t)).replace(/\s+/g, '[\\s-]+')}(?:s|es)?(?=[^a-z0-9]|$)`, 'i');
const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
const pageName = u => { try { const seg = decodeURIComponent(new URL(u).pathname).split('/').filter(x => x && !/^[a-z]{2}(-[a-z]{2})?$/i.test(x)).pop() || ''; const t = seg.replace(/\.[a-z0-9]{2,4}$/i, '').replace(/[-_]+/g, ' ').trim(); return t ? t[0].toUpperCase() + t.slice(1) : u; } catch { return u; } };
const pathWords = u => { try { return decodeURIComponent(new URL(u).pathname).replace(/[-_/.]+/g, ' '); } catch { return ''; } };

export function migrateSectors(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS sectors(id TEXT PRIMARY KEY,name TEXT NOT NULL,question TEXT NOT NULL DEFAULT '',terms TEXT NOT NULL DEFAULT '[]',applications TEXT NOT NULL DEFAULT '[]',exclude TEXT NOT NULL DEFAULT '[]',companyIds TEXT NOT NULL DEFAULT '[]',watch TEXT NOT NULL DEFAULT '[]',createdAt TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS item_sectors(kind TEXT NOT NULL,itemId TEXT NOT NULL,sectorId TEXT NOT NULL,companyId TEXT NOT NULL,area TEXT NOT NULL,matched TEXT NOT NULL DEFAULT '[]',basis TEXT NOT NULL DEFAULT '',title TEXT NOT NULL DEFAULT '',url TEXT NOT NULL DEFAULT '',source TEXT NOT NULL DEFAULT '',primarySource INTEGER NOT NULL DEFAULT 0,date TEXT,eventType TEXT NOT NULL DEFAULT '',PRIMARY KEY(kind,itemId,sectorId,companyId));
    CREATE INDEX IF NOT EXISTS item_sectors_sector ON item_sectors(sectorId,companyId,area);`);
}

// Does a text belong to the sector? Returns the matched terms and where they were found.
export function matchSector(sector, { title = '', text = '', url = '' }, { titleOnly = false } = {}) {
  const head = norm(`${title} ${pathWords(url)}`), body = norm(text).slice(0, 4000);
  const excluded = sector.exclude.find(t => termRe(t).test(head) || termRe(t).test(body));
  if (excluded) return null;
  const terms = [...sector.terms, ...sector.applications];
  const inHead = terms.filter(t => termRe(t).test(head));
  if (inHead.length) return { matched: [...new Set([...inHead, ...terms.filter(t => termRe(t).test(body))])].slice(0, 8), basis: 'title' };
  if (titleOnly) return null;
  const inBody = terms.filter(t => termRe(t).test(body));
  return inBody.length >= 2 ? { matched: inBody.slice(0, 8), basis: 'text' } : null;
}

export function createSectors(store, { fail }) {
  const db = store.db;
  migrateSectors(db);
  const view = r => r && ({ ...r, terms: JSON.parse(r.terms), applications: JSON.parse(r.applications), exclude: JSON.parse(r.exclude), companyIds: JSON.parse(r.companyIds), watch: JSON.parse(r.watch) });
  const all = () => db.prepare('SELECT * FROM sectors ORDER BY name').all().map(view);
  const get = id => view(db.prepare('SELECT * FROM sectors WHERE id=?').get(id));

  function save(body, id = randomUUID()) {
    const name = String(body.name || '').trim().slice(0, 80);
    if (!name) throw fail('Give the sector a name.');
    const s = { name, question: String(body.question || '').trim().slice(0, 300), terms: list(body.terms), applications: list(body.applications), exclude: list(body.exclude),
      companyIds: (Array.isArray(body.companyIds) ? body.companyIds : []).filter(c => store.company(c)).slice(0, 50), watch: (Array.isArray(body.watch) ? body.watch : []).filter(x => typeof x === 'string').slice(0, 20) };
    if (!s.terms.length) throw fail('Add at least one word or technology for the sector.');
    if (db.prepare('SELECT 1 FROM sectors WHERE lower(name)=lower(?) AND id<>?').get(name, id)) throw fail('A sector with this name already exists.');
    db.prepare(`INSERT INTO sectors(id,name,question,terms,applications,exclude,companyIds,watch,createdAt) VALUES(?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,question=excluded.question,terms=excluded.terms,applications=excluded.applications,exclude=excluded.exclude,companyIds=excluded.companyIds,watch=excluded.watch`)
      .run(id, s.name, s.question, JSON.stringify(s.terms), JSON.stringify(s.applications), JSON.stringify(s.exclude), JSON.stringify(s.companyIds), JSON.stringify(s.watch), new Date().toISOString());
    retag(id);
    return get(id);
  }
  function remove(id) { db.prepare('DELETE FROM item_sectors WHERE sectorId=?').run(id); return db.prepare('DELETE FROM sectors WHERE id=?').run(id).changes; }

  // Recomputes the sector labels of every item (fast: plain text rules on the local archive).
  function retag(onlyId) {
    const sectors = onlyId ? [get(onlyId)].filter(Boolean) : all();
    const companies = Object.fromEntries(store.companies().map(c => [c.id, c]));
    const ins = db.prepare('INSERT OR REPLACE INTO item_sectors(kind,itemId,sectorId,companyId,area,matched,basis,title,url,source,primarySource,date,eventType) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)');
    const news = db.prepare(`SELECT n.id,n.title,n.summary,n.url,n.source,n.eventType,n.confidence,n.evidence,COALESCE(n.eventDate,n.publishedAt) date,nc.companyId FROM active_news n JOIN news_companies nc ON nc.newsId=n.id WHERE n.review=0`).all();
    const pages = db.prepare("SELECT id,companyId,title,summary,url,kind,COALESCE(publishedAt,lastmod) date FROM active_site_pages WHERE kind<>'event'").all();
    const events = db.prepare('SELECT id,companyId,fairName,sector,sourceTitle,sourceUrl,official,year,startDate date FROM events WHERE hidden=0').all();
    const pubs = db.prepare('SELECT id,companyId,kind,title,venue,detail,url,COALESCE(publishedAt,firstSeen) date FROM publications').all();
    const changes = db.prepare('SELECT c.id,c.companyId,c.added,c.removed,c.detectedAt date,p.url,p.label FROM key_page_changes c JOIN key_pages p ON p.id=c.pageId').all();
    db.transaction(() => {
      for (const s of sectors) {
        db.prepare('DELETE FROM item_sectors WHERE sectorId=?').run(s.id);
        const inSector = id => companies[id] && (!s.companyIds.length || s.companyIds.includes(id));
        const own = (id, url) => !!companies[id]?.website && hostOf(url) === hostOf(companies[id].website);
        for (const n of news) {
          if (!inSector(n.companyId)) continue;
          const m = matchSector(s, { title: n.title, text: n.summary, url: n.url }); if (!m) continue;
          const strategic = n.eventType && n.confidence !== 'low' ? n.eventType : '';
          ins.run('news', n.id, s.id, n.companyId, AREA_OF_EVENT[strategic] || 'visibility', JSON.stringify(m.matched), m.basis, n.title, n.url, n.source, n.evidence === 'primary' || own(n.companyId, n.url) ? 1 : 0, n.date, strategic);
        }
        for (const p of pages) {
          if (!inSector(p.companyId)) continue;
          const m = matchSector(s, { title: p.title, text: p.summary, url: p.url }); if (!m) continue;
          // Pages of the official site that talk about the sector are mostly its offer (products, datasheets); posts and news are visibility.
          ins.run('site', p.id, s.id, p.companyId, ['news', 'post', 'blog'].includes(p.kind) ? 'visibility' : p.kind === 'career' ? 'organisation' : 'offer', JSON.stringify(m.matched), m.basis, p.title || pageName(p.url), p.url, hostOf(p.url), 1, p.date, '');
        }
        const seenFairs = new Set();
        for (const e of events) {
          if (!inSector(e.companyId)) continue;
          const fairKey = `${e.companyId}|${e.fairName}|${e.year || ''}`; if (seenFairs.has(fairKey)) continue; seenFairs.add(fairKey);
          const m = matchSector(s, { title: `${e.fairName} ${e.sector}` }, { titleOnly: true }); if (!m) continue;
          ins.run('event', e.id, s.id, e.companyId, 'visibility', JSON.stringify(m.matched), m.basis, e.year ? `${e.fairName} ${e.year}` : e.fairName, e.sourceUrl, hostOf(e.sourceUrl), e.official ? 1 : 0, e.date, '');
        }
        for (const p of pubs) {
          if (!inSector(p.companyId)) continue;
          const m = matchSector(s, { title: `${p.title} ${p.venue}`, text: p.detail, url: p.url }); if (!m) continue;
          ins.run('publication', p.id, s.id, p.companyId, 'technology', JSON.stringify(m.matched), m.basis, p.title, p.url, hostOf(p.url), 0, p.date, p.kind === 'patent' ? 'patent' : '');
        }
        for (const c of changes) {
          if (!inSector(c.companyId)) continue;
          const m = matchSector(s, { title: c.label, text: [...JSON.parse(c.added), ...JSON.parse(c.removed)].join('. '), url: c.url }); if (!m) continue;
          ins.run('change', c.id, s.id, c.companyId, 'offer', JSON.stringify(m.matched), m.basis, `${c.label || 'Watched page'} changed`, c.url, hostOf(c.url), 1, c.date, 'page_change');
        }
      }
    })();
  }

  // item keys ("news:<id>") in a sector, for the Daily filter
  const keys = sectorId => new Set(db.prepare('SELECT kind||\':\'||itemId k FROM item_sectors WHERE sectorId=?').all(sectorId).map(r => r.k));
  // sector names of every labelled item, for the chips on cards
  function labels(companyId) {
    const rows = db.prepare(`SELECT i.kind||':'||i.itemId k,s.id,s.name FROM item_sectors i JOIN sectors s ON s.id=i.sectorId${companyId ? ' WHERE i.companyId=?' : ''}`).all(...(companyId ? [companyId] : []));
    const out = {}; for (const r of rows) (out[r.k] ||= []).some(x => x.id === r.id) || out[r.k].push({ id: r.id, name: r.name }); return out;
  }

  // Evidence by company and area. Counts are what EMMA has collected; zero means "no public evidence collected".
  function evidence(sectorId, { days = 0, companies = '' } = {}) {
    const s = get(sectorId); if (!s) throw fail('Sector not found.', 404);
    const span = [90, 365].includes(+days) ? +days : 0, since = span ? new Date(Date.now() - span * 86400000).toISOString() : '';
    const wanted = String(companies).split(',').filter(Boolean);
    const ids = wanted.length ? wanted.filter(id => store.company(id)) : (s.companyIds.length ? s.companyIds : [...new Set(db.prepare('SELECT companyId FROM item_sectors WHERE sectorId=?').all(s.id).map(r => r.companyId))]);
    const rows = db.prepare(`SELECT * FROM item_sectors WHERE sectorId=?${since ? ' AND date>=?' : ''} ORDER BY date DESC`).all(s.id, ...(since ? [since] : []));
    const columns = ids.map(id => {
      const c = store.company(id); if (!c) return null;
      const mine = rows.filter(r => r.companyId === id);
      const areas = Object.fromEntries(Object.keys(SECTOR_AREAS).map(a => { const r = mine.filter(x => x.area === a); return [a, { count: r.length, primary: r.filter(x => x.primarySource).length, latest: r[0]?.date || null }]; }));
      return { company: { id: c.id, name: c.name }, inSector: !s.companyIds.length || s.companyIds.includes(id), total: mine.length, areas, fairs: mine.filter(x => x.kind === 'event').length, moves: mine.filter(x => x.eventType).length };
    }).filter(Boolean);
    const items = rows.filter(r => ids.includes(r.companyId)).slice(0, 600).map(r => ({ ...r, matched: JSON.parse(r.matched), companyName: store.company(r.companyId)?.name || '' }));
    return { sector: s, days: span, areas: SECTOR_AREAS, columns, items, summary: columns.map(c => summarySentence(s, c)) };
  }
  function summarySentence(s, c) {
    const found = Object.entries(c.areas).filter(([, v]) => v.count).map(([a, v]) => `${v.count} ${SECTOR_AREAS[a].label.toLowerCase()} ${v.count === 1 ? 'source' : 'sources'}`);
    const missing = Object.entries(c.areas).filter(([, v]) => !v.count).map(([a]) => SECTOR_AREAS[a].label.toLowerCase());
    return { companyId: c.company.id, text: found.length ? `In ${s.name}, EMMA found for ${c.company.name} ${found.join(', ')}${missing.length ? `; no public evidence collected for ${missing.join(', ')}` : ''}.` : `In ${s.name}, EMMA has not collected any public evidence for ${c.company.name} yet.` };
  }

  return { all, get, save, remove, retag, keys, labels, evidence };
}
