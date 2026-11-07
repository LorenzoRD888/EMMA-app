// EMMA learns from your decisions, with plain rules you can see and undo:
//  · sites you always discard are filtered, sites you always keep are trusted;
//  · articles similar to ones you discarded are not proposed again;
//  · searches whose results you always discard are skipped for that company.
// Every decision is stored in the "decisions" table; Settings shows what EMMA learned.
import { randomUUID } from 'node:crypto';
import { similarTitle } from './strategic-events.js';

const KEEP = ['keep', 'star', 'manual'], DROP = ['discard', 'remove'];
const host = u => { try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } };
// "Tavily · Signals · certifications" → "Signals · certifications" (the search engine changes, the search does not).
const PROVIDERS = /^(tavily|exa|jina(?: ai)?|you\.com|brave(?: search)?|serpapi|google(?: via serpapi)?|baidu|web search|web)\s*·\s*/i;
export const searchLabel = l => String(l || '').replace(PROVIDERS, '').trim();

export const LIMITS = { trust: 3, demote: 3, block: 6, skipSearch: 5 };

export function createLearning(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS decisions(id TEXT PRIMARY KEY,at TEXT NOT NULL,action TEXT NOT NULL,kind TEXT NOT NULL,itemId TEXT NOT NULL DEFAULT '',companyId TEXT NOT NULL DEFAULT '',domain TEXT NOT NULL DEFAULT '',label TEXT NOT NULL DEFAULT '',title TEXT NOT NULL DEFAULT '');
    CREATE INDEX IF NOT EXISTS decisions_domain ON decisions(domain);
    CREATE INDEX IF NOT EXISTS decisions_company ON decisions(companyId,action);`);
  let cache = null;
  const stats = () => {
    if (cache) return cache;
    const domains = new Map(), searches = new Map();
    for (const r of db.prepare(`SELECT domain,companyId,label,action,COUNT(*) n FROM decisions WHERE kind='news' GROUP BY domain,companyId,label,action`).all()) {
      const keep = KEEP.includes(r.action) ? r.n : 0, drop = DROP.includes(r.action) ? r.n : 0;
      if (r.domain) { const d = domains.get(r.domain) || { domain: r.domain, keep: 0, drop: 0 }; d.keep += keep; d.drop += drop; domains.set(r.domain, d); }
      if (r.label) { const k = r.companyId + '|' + r.label; const s = searches.get(k) || { companyId: r.companyId, label: r.label, keep: 0, drop: 0 }; s.keep += keep; s.drop += drop; searches.set(k, s); }
    }
    return (cache = { domains, searches });
  };

  function record({ action, kind = 'news', itemId = '', companyId = '', url = '', label = '', title = '' }) {
    if (![...KEEP, ...DROP, 'restore'].includes(action)) return;
    if (action === 'restore') { db.prepare("DELETE FROM decisions WHERE itemId=? AND action IN ('discard','remove')").run(itemId); cache = null; return; }
    db.prepare('INSERT INTO decisions(id,at,action,kind,itemId,companyId,domain,label,title) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(randomUUID(), new Date().toISOString(), action, kind, itemId, companyId, host(url), searchLabel(label).slice(0, 200), String(title || '').slice(0, 300));
    cache = null;
  }

  // Applied after the normal rules (never to the official website).
  function adjust(result, item, company, nameMatches) {
    if (!result || result.reason === 'Official website' || result.verdict === 'profile') return result;
    const d = host(item.url), s = stats().domains.get(d);
    if (result.verdict !== 'reject' && company?.id) {
      const discarded = db.prepare("SELECT title FROM decisions WHERE companyId=? AND kind='news' AND action IN ('discard','remove') AND title<>'' ORDER BY at DESC LIMIT 300").all(company.id);
      if (discarded.some(r => similarTitle(r.title, item.title))) return { verdict: 'reject', reason: 'Similar to an article you discarded' };
    }
    if (s && !s.keep && s.drop >= LIMITS.block) return { verdict: 'reject', reason: `You discarded ${s.drop} articles from ${d}` };
    if (s && !s.keep && s.drop >= LIMITS.demote && result.verdict === 'accept') return { verdict: 'review', reason: `You often discard articles from ${d}` };
    if (s && !s.drop && s.keep >= LIMITS.trust && result.verdict === 'review' && nameMatches && !/old|namesake/i.test(result.reason)) return { verdict: 'accept', reason: `You usually keep articles from ${d}` };
    return result;
  }

  // A search whose results you always discarded for this company is skipped (with the reason in the log).
  function skipTask(companyId, label) {
    const s = stats().searches.get(companyId + '|' + searchLabel(label));
    return s && !s.keep && s.drop >= LIMITS.skipSearch ? `Skipped: you discarded all ${s.drop} articles this search found` : '';
  }

  function summary() {
    const { domains, searches } = stats();
    const all = db.prepare("SELECT action,COUNT(*) n FROM decisions GROUP BY action").all();
    const count = a => all.filter(r => a.includes(r.action)).reduce((s, r) => s + r.n, 0);
    const companies = new Map(db.prepare('SELECT id,name FROM companies').all().map(c => [c.id, c.name]));
    return {
      kept: count(KEEP), discarded: count(DROP),
      trusted: [...domains.values()].filter(d => !d.drop && d.keep >= LIMITS.trust).sort((a, b) => b.keep - a.keep).slice(0, 30),
      blocked: [...domains.values()].filter(d => !d.keep && d.drop >= LIMITS.block).sort((a, b) => b.drop - a.drop).slice(0, 30),
      demoted: [...domains.values()].filter(d => !d.keep && d.drop >= LIMITS.demote && d.drop < LIMITS.block).sort((a, b) => b.drop - a.drop).slice(0, 30),
      skipped: [...searches.values()].filter(s => !s.keep && s.drop >= LIMITS.skipSearch).map(s => ({ ...s, companyName: companies.get(s.companyId) || '' })).slice(0, 30),
      useful: [...searches.values()].filter(s => s.keep >= 2).sort((a, b) => (b.keep - b.drop) - (a.keep - a.drop)).map(s => ({ ...s, companyName: companies.get(s.companyId) || '' })).slice(0, 15),
      people: db.prepare("SELECT COUNT(*) n FROM decisions WHERE kind='person'").get().n,
      limits: LIMITS,
    };
  }

  // "Forget": the decisions about a site (or a search for one company) are deleted, so it goes back to normal.
  function forget(kind, key, companyId = '') {
    let n = 0;
    if (kind === 'domain') n = db.prepare("DELETE FROM decisions WHERE kind='news' AND domain=?").run(String(key)).changes;
    if (kind === 'search') n = db.prepare("DELETE FROM decisions WHERE kind='news' AND companyId=? AND label=?").run(String(companyId), String(key)).changes;
    cache = null; return n;
  }

  return { record, adjust, skipTask, summary, forget };
}
