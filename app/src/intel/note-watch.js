// Post-its that EMMA follows: when you write a note on a company ("are they
// building a plant in Vietnam?"), EMMA
//   1. reads the note and picks the words to look for (names, places, numbers,
//      technical words; with the AI on, also their English equivalents);
//   2. looks in what is already in the archive;
//   3. at each update runs one search for the note and checks the new results;
//   4. shows on the post-it what it found, with link and date.
// You can stop it on each post-it ("Stop following").

const norm = s => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
const host = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
const STOP = new Set(`a ad al alla alle allo agli ai anche ancora che chi ci come con contro cosa da dal dalla dalle dei del della delle dello di dove e ed fra gli ha hanno ho il in la le lo loro ma mi ne nei nel nella nelle no non o per perche più piu poi quale quali quando quanto quello questa questo se sei si sia sono su sua sue suo sul sulla tra tu un una uno vi
 verificare controllare capire sapere vedere cercare guardare chiedere stanno stato stata fanno fatto fare essere avere dovrebbe potrebbe forse sembra notizia notizie informazioni info azienda aziende società societa nuovo nuova nuovi nuove
 the and or of to in on at for from by with about into is are was were be been has have had will would should could may might this that these those it its their they them we our you your there what which who whom whose when where why how not no yes if then than also just only very more most new news check find whether company companies information
 der die das und oder mit von für fur ist sind ein eine einen auf aus bei nach über uber le la les et ou des du un une pour par avec sur dans est sont el los las y o del con por para una unos`.split(/\s+/));
const NUMBER = /\b\d[\d.,]*\s?(?:kv|v|kw|mw|gw|w|%|mm|µm|um|°c|kt|t|m²|m2|eur|€|usd|\$|bn|mln|million|billion|miliardi|milioni)(?![\p{L}])/giu;

// The words to look for, most specific first: "quoted phrases", numbers with units, names and acronyms, then long words.
export function noteTerms(note, company = {}, extra = []) {
  const text = `${note.title || ''}\n${note.content || ''}`;
  const own = new Set([company.name, ...(company.aliases || [])].filter(Boolean).flatMap(n => norm(n).split(/\s+/)));
  const out = [], seen = new Set();
  const add = (t, specific, ai = false) => {
    const v = String(t || '').replace(/^[^\p{L}\p{N}"]+|[^\p{L}\p{N}%°€$²"]+$/gu, '').trim(); const k = norm(v);
    if (!v || k.length < 2 || seen.has(k) || STOP.has(k) || k.split(/\s+/).every(w => own.has(w) || STOP.has(w))) return;
    seen.add(k); out.push({ term: v, specific, ...(ai ? { ai: true } : {}) });
  };
  for (const m of text.matchAll(/["“«]([^"”»]{2,60})["”»]/g)) add(m[1], true);
  for (const m of text.matchAll(NUMBER)) add(m[0], true);
  for (const m of text.matchAll(/\b[A-Z]{2,}[A-Z0-9-]*\b/g)) add(m[0], true);
  // Capitalised names; the first word of a sentence counts only when followed by another capitalised word ("Mario Rossi").
  for (const sentence of text.split(/[\n.!?;:]+/)) {
    for (const m of sentence.matchAll(/(?:^|[^\p{L}])(\p{Lu}[\p{L}\d&.-]+(?:[ \t]+\p{Lu}[\p{L}\d&.-]+){0,3})/gu)) {
      const first = sentence.trimStart().startsWith(m[1]);
      if (first && !/\s/.test(m[1]) && !/^[A-Z0-9-]+$/.test(m[1])) continue;
      add(m[1], true);
    }
  }
  for (const t of extra) add(t, /[A-Z0-9]/.test(t), true);
  const inSpecific = w => out.some(t => t.specific && norm(t.term).split(/\s+/).includes(w));
  for (const w of norm(text).split(/[^\p{L}\p{N}-]+/u)) if (w.length >= 5 && !/^\d+$/.test(w) && !inSpecific(w)) add(w, false);
  const specific = out.filter(t => t.specific), generic = out.filter(t => !t.specific);
  return [...specific, ...generic].slice(0, 8);
}

// Search: the company + the note's names/places/numbers (and the AI's English keywords), else its main words.
export function noteQuery(company, terms) {
  const specific = terms.filter(t => t.specific && !t.ai).slice(0, 3), ai = terms.filter(t => t.ai && !t.specific).slice(0, 3);
  const pick = specific.length || ai.length ? [...specific, ...ai] : terms.slice(0, 3);
  const words = pick.map(t => /\s/.test(t.term) ? `"${t.term.replaceAll('"', '')}"` : t.term);
  return `"${String(company.name).replaceAll('"', '')}" ${words.join(' ')}`.trim();
}

// An article (already about this company) answers the note if it contains one of its specific words, or several of its words.
export function matchNote(item, terms) {
  if (!terms.length) return null;
  const text = ' ' + norm(`${item.title} ${item.summary || ''} ${item.lead || ''}`) + ' ';
  const has = t => { const k = norm(t.term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*'); return new RegExp(`(^|[^\\p{L}\\p{N}])${k}`, 'u').test(text); };
  const hit = terms.filter(has);
  const score = hit.reduce((s, t) => s + (t.specific ? 2 : 1), 0);
  // A name, place, number or phrase of the note, or at least three of its words.
  return hit.some(t => t.specific) || score >= 3 ? hit.map(t => t.term) : null;
}

export function createNoteWatch(db, store) {
  const cols = db.prepare('PRAGMA table_info(company_entries)').all().map(c => c.name);
  if (!cols.includes('watch')) db.exec('ALTER TABLE company_entries ADD COLUMN watch INTEGER NOT NULL DEFAULT 1');
  if (!cols.includes('lastCheckedAt')) db.exec('ALTER TABLE company_entries ADD COLUMN lastCheckedAt TEXT');
  if (!cols.includes('aiTerms')) db.exec("ALTER TABLE company_entries ADD COLUMN aiTerms TEXT NOT NULL DEFAULT ''");
  db.exec(`CREATE TABLE IF NOT EXISTS note_findings(noteId TEXT NOT NULL,url TEXT NOT NULL,title TEXT NOT NULL,source TEXT NOT NULL DEFAULT '',date TEXT,matched TEXT NOT NULL DEFAULT '',review INTEGER NOT NULL DEFAULT 0,foundAt TEXT NOT NULL,PRIMARY KEY(noteId,url))`);
  const now = () => new Date().toISOString();
  const open = companyId => db.prepare("SELECT * FROM company_entries WHERE companyId=? AND type='note' AND deletedAt IS NULL AND watch=1 ORDER BY updatedAt DESC").all(companyId);
  const extraOf = n => { try { return JSON.parse(n.aiTerms || '[]'); } catch { return []; } };
  const termsOf = (n, c) => noteTerms(n, c, extraOf(n));

  function record(note, item, matched) {
    return db.prepare('INSERT OR IGNORE INTO note_findings(noteId,url,title,source,date,matched,review,foundAt) VALUES(?,?,?,?,?,?,?,?)')
      .run(note.id, item.url, String(item.title || item.url).slice(0, 300), item.source || host(item.url), item.publishedAt || item.date || null, matched.join(', '), item.review ? 1 : 0, now()).changes;
  }
  // New results of an update (or any list of articles) are checked against the company's open notes.
  function matchItems(companyId, items) {
    const c = store.company(companyId); if (!c) return 0;
    let n = 0;
    for (const note of open(companyId)) { const terms = termsOf(note, c); for (const it of items) { if (!it.url) continue; const m = matchNote(it, terms); if (m) n += record(note, it, m); } }
    return n;
  }
  // What is already in the archive: news and pages of the company's website.
  function checkArchive(noteId) {
    const note = db.prepare('SELECT * FROM company_entries WHERE id=?').get(noteId); if (!note || note.type !== 'note') return 0;
    const c = store.company(note.companyId); if (!c) return 0;
    const terms = termsOf(note, c); let n = 0;
    const news = db.prepare('SELECT n.* FROM active_news n JOIN news_companies nc ON nc.newsId=n.id WHERE nc.companyId=?').all(c.id);
    const pages = db.prepare('SELECT url,title,summary,publishedAt FROM active_site_pages WHERE companyId=?').all(c.id).map(p => ({ ...p, source: host(p.url) }));
    for (const it of [...news, ...pages]) { const m = matchNote(it, terms); if (m) n += record(note, it, m); }
    db.prepare('UPDATE company_entries SET lastCheckedAt=? WHERE id=?').run(now(), noteId);
    return n;
  }
  // One search per open note (the 3 most recent per company) at each update.
  function tasks(company, { maxResults = 10 } = {}) {
    return open(company.id).slice(0, 3).map(note => {
      const terms = termsOf(note, company);
      return terms.length ? { engine: 'web', topic: 'general', recent: false, maxResults, query: noteQuery(company, terms), label: 'Your post-it · ' + String(note.title).slice(0, 50), noteId: note.id } : null;
    }).filter(Boolean);
  }
  const markChecked = companyId => db.prepare("UPDATE company_entries SET lastCheckedAt=? WHERE companyId=? AND type='note' AND deletedAt IS NULL AND watch=1").run(now(), companyId);
  function setWatch(noteId, on) { return db.prepare("UPDATE company_entries SET watch=? WHERE id=? AND type='note'").run(on ? 1 : 0, noteId).changes; }
  function setAiTerms(noteId, terms) { db.prepare('UPDATE company_entries SET aiTerms=? WHERE id=?').run(JSON.stringify((terms || []).map(t => String(t).slice(0, 60)).filter(Boolean).slice(0, 8)), noteId); }
  // For the post-its of one company: what EMMA looks for and what it found.
  function forCompany(companyId) {
    const c = store.company(companyId); if (!c) return {};
    const out = {};
    for (const note of db.prepare("SELECT * FROM company_entries WHERE companyId=? AND type='note' AND deletedAt IS NULL").all(companyId)) {
      const terms = termsOf(note, c);
      out[note.id] = { watch: !!note.watch, terms: terms.map(t => t.term), query: terms.length ? noteQuery(c, terms) : '', lastCheckedAt: note.lastCheckedAt, findings: db.prepare('SELECT * FROM note_findings WHERE noteId=? ORDER BY COALESCE(date,foundAt) DESC LIMIT 12').all(note.id), total: db.prepare('SELECT COUNT(*) n FROM note_findings WHERE noteId=?').get(note.id).n };
    }
    return out;
  }
  // Findings of the last days, for "What changed".
  function recent(since) {
    return db.prepare("SELECT f.*,e.title noteTitle,e.companyId,c.name companyName FROM note_findings f JOIN company_entries e ON e.id=f.noteId JOIN companies c ON c.id=e.companyId WHERE e.deletedAt IS NULL AND f.foundAt>=? ORDER BY f.foundAt DESC").all(since);
  }
  return { tasks, matchItems, checkArchive, markChecked, setWatch, setAiTerms, forCompany, recent, termsOf };
}
