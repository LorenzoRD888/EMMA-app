// Is a link safe to open? An indication, never a guarantee.
//  · Local rules (nothing leaves the computer): look-alike names of known sites,
//    shortened or disguised links, file downloads, unusual characters, risky
//    domain endings, people-search sites.
//  · Optional: Google Safe Browsing (free key), which knows sites reported for
//    phishing or malware. Only then is the address sent to Google.
// Levels: trusted (source you or EMMA know), ok (nothing found), warn (doubt, with reasons), danger.
import { isJunkSite } from './relevance.js';

const host = u => { try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; } };
const MULTI = new Set(['co.uk', 'com.au', 'co.jp', 'com.cn', 'com.br', 'co.kr', 'com.tw', 'co.in', 'com.mx', 'co.nz', 'com.tr', 'com.sg', 'com.hk', 'co.za', 'org.uk', 'gov.uk', 'ac.uk', 'com.vn', 'co.id', 'com.my']);
export function registrable(h) { const p = String(h || '').split('.'); if (p.length < 2) return h; const two = p.slice(-2).join('.'); return MULTI.has(two) && p.length >= 3 ? p.slice(-3).join('.') : two; }
const labelOf = h => registrable(h).split('.')[0];

const SHORTENERS = new Set(['bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'ow.ly', 'buff.ly', 'is.gd', 'cutt.ly', 'rebrand.ly', 'shorturl.at', 'rb.gy', 'tiny.cc', 'lnkd.in', 'trib.al', 's.id', 'v.gd', 'bl.ink', 'short.io', 'shorte.st', 'adf.ly', 'qrco.de']);
const RISKY_TLD = new Set(['zip', 'mov', 'top', 'xyz', 'click', 'link', 'work', 'gq', 'tk', 'ml', 'cf', 'ga', 'rest', 'cam', 'icu', 'buzz', 'sbs', 'cfd', 'quest', 'monster', 'country', 'kim', 'loan', 'win', 'bid', 'racing', 'stream', 'download', 'review', 'party', 'cricket', 'science', 'date', 'faith', 'accountant']);
const DANGER_FILES = /\.(exe|msi|scr|bat|cmd|com|vbs|vbe|js|jse|wsf|jar|ps1|apk|app|pkg|dmg|iso|img|lnk|hta|cpl)$/i;
const ARCHIVE_FILES = /\.(zip|rar|7z|tar|gz|tgz|bz2|xz|cab)$/i;
const OFFICE_MACRO = /\.(docm|xlsm|pptm|xlam)$/i;
// Sites that phishing pages imitate most often, and their real domains.
const BRANDS = { linkedin: ['linkedin.com', 'lnkd.in'], google: ['google.com', 'google.it', 'goo.gl', 'googleapis.com', 'googleusercontent.com'], microsoft: ['microsoft.com', 'live.com', 'office.com', 'microsoftonline.com', 'sharepoint.com', 'outlook.com'], office365: ['office.com'], outlook: ['outlook.com', 'live.com'], sharepoint: ['sharepoint.com'], onedrive: ['live.com', 'onedrive.com'], apple: ['apple.com', 'icloud.com'], icloud: ['icloud.com'], amazon: ['amazon.com', 'amazon.it', 'amazon.de', 'amazon.co.uk', 'amazonaws.com'], paypal: ['paypal.com'], facebook: ['facebook.com', 'fb.com'], instagram: ['instagram.com'], youtube: ['youtube.com', 'youtu.be'], github: ['github.com', 'githubusercontent.com'], dropbox: ['dropbox.com'], wetransfer: ['wetransfer.com', 'we.tl'], docusign: ['docusign.com', 'docusign.net'], adobe: ['adobe.com'], zoom: ['zoom.us'], dhl: ['dhl.com', 'dhl.de', 'dhl.it'], fedex: ['fedex.com'], ups: ['ups.com'], netflix: ['netflix.com'], whatsapp: ['whatsapp.com'], telegram: ['telegram.org', 't.me'], intesasanpaolo: ['intesasanpaolo.com'], unicredit: ['unicredit.it', 'unicredit.eu'], poste: ['poste.it', 'posteitaliane.it'] };
// Well-known publishers: reliable as sources (the content is still to be read critically).
const KNOWN = new Set(['reuters.com', 'bloomberg.com', 'ft.com', 'wsj.com', 'economist.com', 'nytimes.com', 'bbc.co.uk', 'bbc.com', 'theguardian.com', 'cnbc.com', 'forbes.com', 'apnews.com', 'afp.com', 'ansa.it', 'ilsole24ore.com', 'corriere.it', 'repubblica.it', 'handelsblatt.com', 'faz.net', 'lesechos.fr', 'lemonde.fr', 'elpais.com', 'expansion.com', 'nikkei.com', 'asia.nikkei.com', 'scmp.com', 'caixinglobal.com', 'techcrunch.com', 'theverge.com', 'wired.com', 'pv-magazine.com', 'pv-tech.org', 'businesswire.com', 'prnewswire.com', 'globenewswire.com', 'wikipedia.org', 'linkedin.com', 'youtube.com', 'github.com', 'europa.eu', 'epo.org', 'wipo.int', 'uspto.gov', 'google.com', 'sciencedirect.com', 'springer.com', 'nature.com', 'wiley.com', 'mdpi.com', 'ieee.org', 'arxiv.org', 'openalex.org', 'doi.org']);

function distance(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 9;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1), i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1] ? d[i - 2][j - 2] + 1 : 99);
  return d[a.length][b.length];
}
// "linkedln", "paypa1", "rnicrosoft": one or two characters away from a known name.
const unconfuse = s => s.replace(/rn/g, 'm').replace(/vv/g, 'w').replace(/0/g, 'o').replace(/1/g, 'l').replace(/3/g, 'e').replace(/5/g, 's');

/**
 * @param {string} url
 * @param {{trusted?: Set<string>, companies?: {name: string, domain: string}[]}} known
 *   trusted: domains of followed companies and sites you usually keep; companies: look-alike check against them.
 */
export function checkLink(url, { trusted = new Set(), companies = [] } = {}) {
  let u; try { u = new URL(url); } catch { return { level: 'danger', reasons: ['Not a valid web address'] }; }
  if (!/^https?:$/.test(u.protocol)) return { level: 'danger', reasons: [`Not a web page (${u.protocol.replace(':', '')})`] };
  const h = u.hostname.toLowerCase().replace(/^www\./, ''), reg = registrable(h), label = labelOf(h), tld = h.split('.').pop();
  const reasons = [], danger = [];
  if (u.username || u.password) danger.push('The address contains a hidden user name (typical of phishing)');
  if (/^xn--|\.xn--/.test(h)) reasons.push('Unusual characters in the address (could imitate another site)');
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.startsWith('[')) reasons.push('Number address instead of a site name');
  if (SHORTENERS.has(h)) reasons.push('Shortened link: the real destination is hidden');
  if (u.protocol === 'http:') reasons.push('Not encrypted (http)');
  if (RISKY_TLD.has(tld)) reasons.push(`Domain ending “.${tld}” is often used for scams`);
  const file = decodeURIComponent(u.pathname).split('/').pop() || '';
  if (DANGER_FILES.test(file)) danger.push(`Downloads a program file (${file.split('.').pop().toLowerCase()})`);
  else if (ARCHIVE_FILES.test(file)) reasons.push(`Downloads a compressed file (${file.split('.').pop().toLowerCase()})`);
  else if (OFFICE_MACRO.test(file)) reasons.push('Downloads an Office file with macros');
  if (isJunkSite(url)) reasons.push('People-search or website-statistics site');
  for (const p of ['url', 'redirect', 'redirect_uri', 'goto', 'dest', 'destination', 'next', 'target', 'u']) { const v = u.searchParams.get(p); if (v && /^https?:\/\//i.test(v) && host(v) && registrable(host(v)) !== reg) { reasons.push(`Redirects to another site (${host(v)})`); break; } }
  // Look-alikes of famous sites and of the companies you follow.
  const real = new Set(Object.values(BRANDS).flat().concat(companies.map(c => registrable(c.domain)).filter(Boolean)));
  if (!real.has(reg) && !trusted.has(reg)) {
    const flat = unconfuse(h.replace(/[.-]/g, ''));
    for (const [brand, domains] of Object.entries(BRANDS)) {
      if (domains.some(d => reg === d)) break;
      const near = label.length >= 5 && distance(unconfuse(label), brand) <= (brand.length >= 8 ? 2 : 1) && label !== brand;
      const inside = brand.length >= 5 && flat.includes(brand) && (h.split('.').length > 3 || /[-]/.test(h) || label !== brand);
      if (near || inside) { danger.push(`Looks like ${domains[0]} but it is ${reg}`); break; }
    }
    for (const c of companies) {
      const cl = labelOf(host(c.domain)); if (!cl || cl.length < 5 || reg === registrable(host(c.domain))) continue;
      if (label !== cl && distance(unconfuse(label), cl) <= 1) { danger.push(`Looks like the site of ${c.name} (${registrable(host(c.domain))}) but it is ${reg}`); break; }
    }
  }
  if (/(login|signin|sign-in|verify|account|password|secure|update|wallet|banking)/i.test(u.pathname + u.hostname) && !real.has(reg) && !trusted.has(reg) && !KNOWN.has(reg) && (reasons.length || h.split('.').length > 3)) reasons.push('Asks for a login on an unknown site');
  if (danger.length) return { level: 'danger', reasons: [...danger, ...reasons] };
  if (reasons.length) return { level: 'warn', reasons };
  if (trusted.has(reg)) return { level: 'trusted', reasons: ['Source you follow or usually keep'] };
  if (KNOWN.has(reg) || KNOWN.has(h)) return { level: 'trusted', reasons: ['Well-known publisher'] };
  return { level: 'ok', reasons: ['No problem found by the checks'] };
}

// Google Safe Browsing (v4 Lookup API): sites reported for phishing, malware or unwanted software.
export async function safeBrowsing(urls, { key = process.env.SAFE_BROWSING_API_KEY, fetchFn = fetch } = {}) {
  if (!key || !urls.length) return new Map();
  const body = { client: { clientId: 'emma-local', clientVersion: '1' }, threatInfo: { threatTypes: ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE', 'POTENTIALLY_HARMFUL_APPLICATION'], platformTypes: ['ANY_PLATFORM'], threatEntryTypes: ['URL'], threatEntries: urls.slice(0, 500).map(url => ({ url })) } };
  const r = await fetchFn('https://safebrowsing.googleapis.com/v4/threatMatches:find?key=' + encodeURIComponent(key), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(6000) });
  if (!r.ok) throw Object.assign(Error(`Safe Browsing answered ${r.status}`), { public: true });
  const out = new Map();
  for (const m of (await r.json()).matches || []) out.set(m.threat?.url, { MALWARE: 'malware', SOCIAL_ENGINEERING: 'phishing or deceptive site', UNWANTED_SOFTWARE: 'unwanted software', POTENTIALLY_HARMFUL_APPLICATION: 'harmful app' }[m.threatType] || 'dangerous site');
  return out;
}

// Results are kept for a week (reported sites for a day), so pages open quickly.
export function createLinkSafety(db, store, { fetchFn = fetch, trustedDomains = () => [] } = {}) {
  db.exec('CREATE TABLE IF NOT EXISTS link_checks(url TEXT PRIMARY KEY,threat TEXT NOT NULL DEFAULT \'\',checkedAt TEXT NOT NULL)');
  const companies = () => store.companies().filter(c => c.website).map(c => ({ name: c.name, domain: c.website }));
  async function check(urls) {
    const list = [...new Set(urls.filter(u => typeof u === 'string' && /^https?:\/\//i.test(u)))].slice(0, 600);
    const comps = companies();
    const mine = (() => { try { return store.pref('myCompany', {}).website || ''; } catch { return ''; } })();
    const trusted = new Set([...comps.map(c => registrable(host(c.domain))), ...trustedDomains().map(registrable), mine && registrable(host(mine))].filter(Boolean));
    const out = {};
    for (const url of list) out[url] = checkLink(url, { trusted, companies: [...comps, ...(mine ? [{ name: 'your company', domain: mine }] : [])] });
    // Google Safe Browsing, only for links not checked recently and only if you set the key.
    let google = { used: !!process.env.SAFE_BROWSING_API_KEY, error: '' };
    if (google.used) {
      const week = new Date(Date.now() - 7 * 86400000).toISOString(), day = new Date(Date.now() - 86400000).toISOString();
      const cached = new Map(db.prepare(`SELECT * FROM link_checks WHERE url IN (${list.map(() => '?').join(',') || "''"})`).all(...list).map(r => [r.url, r]));
      const todo = list.filter(u => { const c = cached.get(u); return !c || c.checkedAt < (c.threat ? day : week); });
      if (todo.length) {
        try {
          const found = await safeBrowsing(todo, { fetchFn });
          const now = new Date().toISOString(), save = db.prepare('INSERT OR REPLACE INTO link_checks(url,threat,checkedAt) VALUES(?,?,?)');
          db.transaction(() => { for (const u of todo) { save.run(u, found.get(u) || '', now); cached.set(u, { url: u, threat: found.get(u) || '', checkedAt: now }); } })();
        } catch (e) { google.error = e.public ? e.message : 'Safe Browsing not reachable'; }
      }
      for (const url of list) { const c = cached.get(url); if (c?.threat) out[url] = { level: 'danger', reasons: [`Reported by Google Safe Browsing: ${c.threat}`, ...out[url].reasons.filter(r => !/No problem|Well-known|Source you/.test(r))] }; else if (c) out[url] = { ...out[url], google: true }; }
    }
    return { results: out, google };
  }
  return { check };
}
