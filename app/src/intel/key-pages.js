// Watched key pages (catalogue, price list, product pages…): EMMA keeps the
// readable text of each page and reports which lines were added or removed.
// The first read is only a baseline. Lines that change on every visit (times,
// counters, copyright years, cookie banners) are ignored to avoid false alarms.
import { randomUUID } from 'node:crypto';

const NOISE = /^(?:\d{1,2}[:.]\d{2}(?:\s?[ap]m)?|©.*|copyright.*|all rights reserved.*|.*cookies?.*|.*\b(?:loading|caricamento)\b.*|[\d\s.,:/-]+|share|condividi|menu|search|cerca)$/i;

const decode = s => s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&euro;/g, '€');

export function pageLines(html) {
  const body = String(html || '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|template|iframe)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(nav|footer)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/td|\/th|\/section|\/article|\/dt|\/dd|\/option)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  const seen = new Set(), out = [];
  for (const raw of decode(body).split('\n')) {
    const line = raw.replace(/\s+/g, ' ').trim().slice(0, 300);
    if (line.length < 2 || NOISE.test(line) || seen.has(line)) continue;
    seen.add(line); out.push(line);
    if (out.length >= 3000) break;
  }
  return out;
}

export function diffLines(before, after) {
  const a = new Set(before), b = new Set(after);
  return { added: after.filter(l => !a.has(l)), removed: before.filter(l => !b.has(l)) };
}

export function migrateKeyPages(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS key_pages(id TEXT PRIMARY KEY,companyId TEXT NOT NULL,url TEXT NOT NULL,label TEXT NOT NULL DEFAULT '',lines TEXT NOT NULL DEFAULT '[]',createdAt TEXT NOT NULL,lastChecked TEXT,lastChanged TEXT,status TEXT NOT NULL DEFAULT 'new',error TEXT NOT NULL DEFAULT '',UNIQUE(companyId,url));
    CREATE TABLE IF NOT EXISTS key_page_changes(id TEXT PRIMARY KEY,pageId TEXT NOT NULL,companyId TEXT NOT NULL,detectedAt TEXT NOT NULL,added TEXT NOT NULL DEFAULT '[]',removed TEXT NOT NULL DEFAULT '[]');`);
}

export function createKeyPages(store, { fetchPage, pageHtml, canonical, fail }) {
  const db = store.db;
  const view = p => p && ({ ...p, lines: undefined, lineCount: JSON.parse(p.lines).length, changes: db.prepare('SELECT * FROM key_page_changes WHERE pageId=? ORDER BY detectedAt DESC LIMIT 10').all(p.id).map(changeView) });
  const changeView = c => ({ ...c, added: JSON.parse(c.added), removed: JSON.parse(c.removed) });
  const list = companyId => db.prepare('SELECT * FROM key_pages WHERE companyId=? ORDER BY createdAt').all(companyId).map(view);

  async function check(id) {
    const p = db.prepare('SELECT * FROM key_pages WHERE id=?').get(id);
    if (!p) throw fail('Page not found.', 404);
    const now = new Date().toISOString();
    try {
      const r = await fetchPage(p.url, { maxBytes: 4 * 1024 * 1024, signal: AbortSignal.timeout(20000) });
      if (!r.ok) throw Object.assign(Error(`The page answered with error ${r.status}.`), { public: true });
      if (!/html|xhtml|text\/plain/i.test(r.headers.get('content-type') || '')) throw Object.assign(Error('Not a web page (PDF or file): EMMA can watch only web pages.'), { public: true });
      const lines = pageLines(await pageHtml(r));
      if (!lines.length) throw Object.assign(Error('No readable text on the page.'), { public: true });
      const before = JSON.parse(p.lines);
      if (p.status === 'new' || !before.length) {
        db.prepare("UPDATE key_pages SET lines=?,lastChecked=?,status='ok',error='' WHERE id=?").run(JSON.stringify(lines), now, id);
        return { baseline: true, changed: false };
      }
      const d = diffLines(before, lines);
      db.prepare("UPDATE key_pages SET lines=?,lastChecked=?,status='ok',error='' WHERE id=?").run(JSON.stringify(lines), now, id);
      if (!d.added.length && !d.removed.length) return { changed: false };
      const change = { id: randomUUID(), pageId: id, companyId: p.companyId, detectedAt: now, added: d.added.slice(0, 40), removed: d.removed.slice(0, 40) };
      db.prepare('INSERT INTO key_page_changes(id,pageId,companyId,detectedAt,added,removed) VALUES(?,?,?,?,?,?)').run(change.id, id, p.companyId, now, JSON.stringify(change.added), JSON.stringify(change.removed));
      db.prepare('UPDATE key_pages SET lastChanged=? WHERE id=?').run(now, id);
      return { changed: true, change: { ...change, addedCount: d.added.length, removedCount: d.removed.length } };
    } catch (e) {
      db.prepare("UPDATE key_pages SET lastChecked=?,status='error',error=? WHERE id=?").run(now, e.public ? e.message : 'Page not reachable.', id);
      return { error: e.public ? e.message : 'Page not reachable.' };
    }
  }

  async function add(companyId, { url, label }) {
    if (!store.company(companyId)) throw fail('Company not found.', 404);
    let target;
    try { target = canonical(String(url || '').trim()); } catch { throw fail('Paste a valid web address (https://…).'); }
    if (db.prepare('SELECT COUNT(*) n FROM key_pages WHERE companyId=?').get(companyId).n >= 20) throw fail('At most 20 watched pages per company.');
    if (db.prepare('SELECT 1 FROM key_pages WHERE companyId=? AND url=?').get(companyId, target)) throw fail('This page is already watched.');
    const id = randomUUID();
    db.prepare('INSERT INTO key_pages(id,companyId,url,label,createdAt) VALUES(?,?,?,?,?)').run(id, companyId, target, String(label || '').trim().slice(0, 80), new Date().toISOString());
    const result = await check(id);
    return { page: view(db.prepare('SELECT * FROM key_pages WHERE id=?').get(id)), result };
  }

  function remove(id) {
    db.prepare('DELETE FROM key_page_changes WHERE pageId=?').run(id);
    return db.prepare('DELETE FROM key_pages WHERE id=?').run(id).changes;
  }

  async function checkCompany(companyId) {
    const changes = [];
    for (const p of db.prepare('SELECT id FROM key_pages WHERE companyId=?').all(companyId)) {
      const r = await check(p.id);
      if (r.changed) changes.push(r.change);
    }
    return changes;
  }

  // Changes as Signal Center items.
  function changes({ since, ids = [] } = {}) {
    const filter = ids.length ? ` AND c.companyId IN (${ids.map(() => '?').join(',')})` : '';
    return db.prepare(`SELECT c.*,p.url,p.label,co.name companyName,co.website,co.watchEvents FROM key_page_changes c JOIN key_pages p ON p.id=c.pageId JOIN companies co ON co.id=c.companyId WHERE c.detectedAt>=?${filter} ORDER BY c.detectedAt DESC`).all(since, ...ids).map(changeView);
  }

  return { list, add, remove, check, checkCompany, changes };
}
