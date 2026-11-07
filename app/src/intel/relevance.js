// Relevance rules used by judge(): directory pages, generic words, strong
// proofs that an article is about THIS company, and probably-old articles.

const norm = s => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } };
const pathOf = u => { try { return new URL(u).pathname.toLowerCase(); } catch { return ''; } };

// Company directories and profile pages: useful as references, but they are not news.
const PROFILE_RULES = [
  ['linkedin.com', /^\/(company|showcase|school)\//], ['crunchbase.com', /^\/organization\//], ['pitchbook.com', /^\/profiles\//],
  ['bloomberg.com', /^\/profile\//], ['zoominfo.com', /^\/(c|co|pic)\//], ['rocketreach.co', /./], ['apollo.io', /^\/companies\//],
  ['dnb.com', /^\/business-directory\//], ['preqin.com', /./], ['owler.com', /^\/company\//], ['craft.co', /./], ['cbinsights.com', /^\/company\//],
  ['tracxn.com', /^\/d\/companies\//], ['signalhire.com', /./], ['lusha.com', /./], ['glassdoor.com', /overview|reviews/], ['glassdoor.co.uk', /overview|reviews/],
  ['indeed.com', /^\/cmp\//], ['opencorporates.com', /./], ['company-information.service.gov.uk', /./], ['kompass.com', /./], ['europages.com', /./],
  ['manta.com', /./], ['theorg.com', /./], ['leadiq.com', /./], ['contactout.com', /./], ['datanyze.com', /./], ['prospeo.io', /./], ['golden.com', /./],
  ['inc.com', /^\/profile\//], ['companieshouse.id', /./], ['cybo.com', /./], ['yelp.com', /^\/biz\//], ['clutch.co', /^\/profile\//], ['g2.com', /^\/(products|sellers)\//],
  ['dealroom.co', /^\/companies\//], ['f6s.com', /./], ['wellfound.com', /^\/company\//], ['angel.co', /^\/company\//], ['bizapedia.com', /./], ['buzzfile.com', /./],
  ['tavily.com', /./], ['linkedin.com', /^\/(in|pub)\//], ['play.google.com', /^\/store\/apps/], ['apps.apple.com', /./],
];
export function isProfilePage(url) {
  const h = hostOf(url), p = pathOf(url);
  return PROFILE_RULES.some(([d, re]) => (h === d || h.endsWith('.' + d)) && re.test(p));
}
export const PROFILE_HOSTS = PROFILE_RULES.map(([d]) => d);

// People-search, link-shortener and "website value" pages: never useful.
const JUNK = ['whitepages.com', 'spokeo.com', 'radaris.com', 'mylife.com', 'truepeoplesearch.com', 'fastpeoplesearch.com', 'peoplefinders.com', 'beenverified.com', 'intelius.com', 'zabasearch.com', 'peekyou.com', 'sur.ly', 'hypestat.com', 'statshow.com', 'siteprice.org', 'websiteoutlook.com', 'sitelike.org', 'similarsites.com', 'site-stats.org', 'w3techs.com', 'builtwith.com', 'whois.com', 'who.is', 'domaintools.com', 'urlscan.io', 'webstatsdomain.org', 'sitesimilar.net', 'trustpilot.com'];
export function isJunkSite(url) { const h = hostOf(url); return JUNK.some(d => h === d || h.endsWith('.' + d)); }

// Words that appear in almost every business article: never a proof of relevance on their own.
export const GENERIC_TERMS = new Set(`strategy strategies growth market markets marketing content digital media insights insight research analyst analysts relations branding brand brands global
 solution solutions service services business businesses company companies group team teams people customer customers client clients industry industries innovation innovative technology
 technologies product products leading leader leaders world worldwide international communication communications news data management manager development partner partners partnership quality
 sustainability sustainable value values experience expertise support network networks platform platforms design engineering consulting consultancy region regions greater studies study case cases
 about contact home page website online offer offers project projects work working works years year since today local national europe european america american asia asian china chinese
 south north east west office offices based leading-edge advanced high performance new latest events event press release story stories blog article articles report reports`.split(/\s+/).filter(Boolean));

export const specificTerms = list => list.filter(w => !GENERIC_TERMS.has(norm(w)));

// The registrable part of the official website, e.g. "branchcomms" from www.branchcomms.example.
export function siteLabel(website) {
  const h = hostOf(website); if (!h) return '';
  const parts = h.split('.'); if (parts.length < 2) return '';
  const second = parts.at(-2), sld = ['co', 'com', 'org', 'net', 'ac', 'gov'].includes(second) && parts.length >= 3 ? parts.at(-3) : second;
  return sld.length >= 4 ? sld : '';
}

// Strong proofs: the website address, a known person of the company, or one of its product names.
export function strongSignal(item, company, { people = [], products = [] } = {}) {
  const text = ' ' + norm(`${item.title} ${item.summary}`) + ' ';
  const site = hostOf(company.website), label = siteLabel(company.website);
  if (site && text.includes(site)) return `Mentions the website ${site}`;
  if (label && new RegExp(`[^a-z0-9]${label}\\.(com|co|net|org|io|it|de|fr|uk|eu|cn)`).test(text)) return `Mentions the website ${label}`;
  const esc = v => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const person = people.find(n => n && n.split(/\s+/).length >= 2 && new RegExp(`[^a-z0-9]${esc(norm(n)).replace(/\s+/g, '\\s+')}[^a-z0-9]`).test(text));
  if (person) return `Mentions ${person}`;
  return null;
}

// Undated article whose text only mentions years well in the past: probably old.
export function probablyOld(item, { years = 3, now = new Date() } = {}) {
  if (item.publishedAt) return null;
  const found = [...String(`${item.title} ${item.summary}`).matchAll(/\b(19[5-9]\d|20[0-4]\d)\b/g)].map(m => +m[1]).filter(y => y <= now.getFullYear());
  if (!found.length) return null;
  const latest = Math.max(...found);
  return latest < now.getFullYear() - years ? latest : null;
}
