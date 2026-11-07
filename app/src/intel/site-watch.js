// Monitor del sito ufficiale: individua da solo le fonti strutturate del
// sito (API WordPress, feed RSS, sitemap) e ne estrae l'elenco delle pagine.
// Confrontando le scansioni nel tempo si vede cosa l'azienda pubblica:
// news, comunicati, fiere, nuovi prodotti, schede tecniche, offerte di lavoro.

import { hasEventSignal } from './fairs.js';
import { extractPreview } from './preview.js';

const STOP = new Set(('the and for with from that this your our you are all more about into over their what which when where will have has can new more than also '
  + 'della delle dello degli dei del per con una uno nel nella nelle sono come anche alla alle allo agli più tra fra che non sul sulla nostro nostra nostri '
  + 'home news contact contacts contatti chi siamo about us company azienda privacy cookie policy menu search cerca read more scopri leggi tutti click here '
  + 'und der die das mit für von den des ist les des pour avec dans une '
  + 'produces produce producing value values innovation innovative leading leader quality solution solutions world global group since years worldwide partner excellence').split(/\s+/));

export const decode = s => String(s ?? '')
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
  .replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&[a-z]+;/gi, ' ');
const strip = (s, max = 4000) => decode(String(s ?? '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim().slice(0, max);
const attr = (tag, name) => tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'))?.slice(2).find(v => v !== undefined) ?? null;

const NOISE = /\/(tag|tags|category|categorie|author|autore|feed|wp-json|wp-admin|wp-login|cart|carrello|checkout|my-account|search|cerca)(\/|$)|\/page\/\d+|[?&](replytocom|s|p|share)=|\.(jpe?g|png|gif|webp|svg|css|js|ico|zip|mp4|webm)(\?|$)|privacy|cookie|terms|condizioni|note-legali|legal-notice|impressum|whistleblow|sitemap/i;

export function classifyPage(url, title = '') {
  const u = String(url).toLowerCase(), t = String(title).toLowerCase();
  if (/\.pdf(\?|$)/.test(u) || /datasheet|data-sheet|scheda-tecnica|technical-data|\/tds|brochure|catalog|catalogue|catalogo|download|certificat/.test(u + ' ' + t)) return 'document';
  if (/\/(career|careers|jobs?|lavora-con-noi|work-with-us|carriere|recruit|posizioni-aperte|job-opportunities|stellenangebote)/.test(u) || /\b(we are hiring|job opening|posizione aperta|cerchiamo)\b/.test(t)) return 'career';
  if (/\/(events?|fair|fairs|fiere?|exhibitions?|messen?|trade-?shows?)(\/|-|$)/.test(u) || hasEventSignal(title)) return 'event';
  if (/\/(news|press|press-release|comunicat|stampa|media|blog|articles?|insights?|stories|aktuelles|novita|notizie|新闻|资讯)(\/|-|$)/.test(u) || /\/20\d\d\/\d\d\//.test(u)) return 'news';
  if (/\/(products?|prodott[oi]|solutions?|soluzion[ei]|range|series|serie|portfolio|applications?|applicazioni|business-units?|markets?|mercati|technolog(y|ies)|tecnologi[ae]|produkte|产品)(\/|-|$)/.test(u)) return 'product';
  return 'page';
}

export function siteProfile(html, url) {
  const head = html.slice(0, 200000);
  const meta = name => {
    for (const tag of head.match(/<meta\b[^>]*>/gi) || []) {
      const key = (attr(tag, 'name') || attr(tag, 'property') || '').toLowerCase();
      if (key === name) return decode(attr(tag, 'content') || '').trim();
    }
    return '';
  };
  const title = strip(head.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '', 300);
  const feeds = [];
  for (const tag of head.match(/<link\b[^>]*>/gi) || []) {
    if (/alternate/i.test(attr(tag, 'rel') || '') && /(rss|atom)\+xml/i.test(attr(tag, 'type') || '')) {
      try { const href = new URL(decode(attr(tag, 'href')), url).href; if (!/comments/i.test(href)) feeds.push(href); } catch {}
    }
  }
  // Voci di menu: link dentro <nav>/<header>, altrimenti i primi link interni.
  const origin = new URL(url).origin;
  const zones = [...html.matchAll(/<(nav|header)\b[\s\S]*?<\/\1>/gi)].map(m => m[0]).join(' ') || html.slice(0, 60000);
  const sections = [];
  for (const m of zones.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = attr(m[1], 'href'), label = strip(m[2], 80);
    if (!href || !label || label.length < 3 || label.length > 50) continue;
    let abs; try { abs = new URL(decode(href), url); } catch { continue; }
    if (abs.origin !== origin || NOISE.test(abs.href)) continue;
    if (STOP.has(label.toLowerCase()) || /^(home|news|contatti|contacts?|chi siamo|about( us)?|login|it|en|de|fr|es|zh|cn)$/i.test(label)) continue;
    if (!sections.some(s => s.label.toLowerCase() === label.toLowerCase())) sections.push({ label, url: abs.href.split('#')[0] });
    if (sections.length >= 40) break;
  }
  const description = meta('description') || meta('og:description');
  return {
    title, description,
    siteName: meta('og:site_name'),
    lang: html.match(/<html\b[^>]*\blang\s*=\s*["']?([\w-]+)/i)?.[1] || '',
    feeds: [...new Set(feeds)].slice(0, 5),
    sections,
  };
}

// Termini di contesto per distinguere l'azienda dagli omonimi.
export function contextTerms(profile, extra = []) {
  const text = [profile?.description, profile?.title, ...(profile?.sections || []).map(s => s.label), ...extra].join(' ');
  const counts = new Map();
  for (const w of text.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').match(/[a-z][a-z-]{4,}/g) || []) {
    if (STOP.has(w)) continue;
    counts.set(w, (counts.get(w) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([w]) => w);
}

export function parseSitemap(xml) {
  const children = [...xml.matchAll(/<sitemap>[\s\S]*?<loc>([\s\S]*?)<\/loc>[\s\S]*?<\/sitemap>/gi)].map(m => decode(m[1]).trim());
  const urls = [...xml.matchAll(/<url>([\s\S]*?)<\/url>/gi)].map(m => ({
    url: decode(m[1].match(/<loc>([\s\S]*?)<\/loc>/i)?.[1] || '').trim(),
    lastmod: m[1].match(/<lastmod>([\s\S]*?)<\/lastmod>/i)?.[1]?.trim() || null,
  })).filter(u => u.url);
  return { children, urls };
}

export function parseFeed(xml) {
  const items = [...xml.matchAll(/<(item|entry)\b[\s\S]*?<\/\1>/gi)].map(m => m[0]);
  return items.map(it => {
    const link = it.match(/<link>([\s\S]*?)<\/link>/i)?.[1] || attr(it.match(/<link\b[^>]*rel=["']?alternate[^>]*>/i)?.[0] || it.match(/<link\b[^>]*>/i)?.[0] || '', 'href') || '';
    return {
      url: decode(link).trim(),
      title: strip(it.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1], 500),
      summary: strip(it.match(/<(description|summary|content:encoded|content)[^>]*>([\s\S]*?)<\/\1>/i)?.[2], 3000),
      publishedAt: (it.match(/<(pubDate|published|updated|dc:date)>([\s\S]*?)<\/\1>/i)?.[2] || '').trim() || null,
    };
  }).filter(i => i.url && i.title);
}

const okDate = v => v && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : null;

async function getText(fetchFn, url, maxBytes = 3 * 1024 * 1024) {
  const r = await fetchFn(url, { maxBytes, signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh) EMMA-market-intelligence', Accept: '*/*' } });
  if (!r.ok) throw Object.assign(new Error('HTTP ' + r.status), { status: r.status });
  return { text: await r.text(), type: r.headers.get('content-type') || '' };
}

// Scansione completa: profilo + elenco pagine da tutte le fonti strutturate disponibili.
export async function scanSite(website, { fetchFn, maxSitemaps = 12, maxUrls = 4000 } = {}) {
  const start = new URL(website), origin = start.origin;
  const methods = [], errors = [], entries = new Map();
  const add = (e, via) => {
    let u; try { u = new URL(e.url, origin); } catch { return; }
    if (u.hostname.replace(/^www\./, '') !== start.hostname.replace(/^www\./, '') || NOISE.test(u.href)) return;
    u.hash = ''; const key = u.href;
    const prev = entries.get(key) || {};
    entries.set(key, {
      url: key, via: prev.via ? prev.via : via,
      title: prev.title || e.title || '', summary: prev.summary || e.summary || '',
      publishedAt: prev.publishedAt || okDate(e.publishedAt), lastmod: okDate(e.lastmod) || prev.lastmod || null,
    });
  };

  let profile = { title: '', description: '', sections: [], feeds: [] };
  try { const home = await getText(fetchFn, start.href); profile = siteProfile(home.text, start.href); methods.push('homepage'); }
  catch (e) { errors.push('Homepage not reachable (' + e.message + ').'); }

  // 1. API WordPress: articoli datati con titolo ed estratto.
  try {
    const { text } = await getText(fetchFn, `${origin}/wp-json/wp/v2/posts?per_page=50&_fields=date,link,title,excerpt`);
    const posts = JSON.parse(text);
    if (Array.isArray(posts) && posts.length) {
      for (const p of posts) add({ url: p.link, title: strip(p.title?.rendered, 500), summary: strip(p.excerpt?.rendered, 2000), publishedAt: p.date }, 'wordpress');
      methods.push('wordpress');
    }
  } catch {}

  // 2. Feed RSS/Atom dichiarati dal sito (o /feed/ standard).
  const feeds = profile.feeds.length ? profile.feeds : methods.includes('wordpress') ? [] : [`${origin}/feed/`];
  for (const feed of feeds.slice(0, 3)) {
    try { const { text } = await getText(fetchFn, feed); const items = parseFeed(text); if (items.length) { items.forEach(i => add(i, 'rss')); methods.push('rss'); } }
    catch {}
  }

  // 3. Sitemap (da robots.txt o percorsi standard): l'elenco completo delle pagine.
  let sitemapRoots = [];
  try { const { text } = await getText(fetchFn, `${origin}/robots.txt`, 512 * 1024); sitemapRoots = [...text.matchAll(/^\s*sitemap:\s*(\S+)/gim)].map(m => m[1]); } catch {}
  if (!sitemapRoots.length) sitemapRoots = [`${origin}/sitemap_index.xml`, `${origin}/sitemap.xml`, `${origin}/wp-sitemap.xml`];
  const queue = [...new Set(sitemapRoots)], seen = new Set();
  let read = 0, foundSitemap = false;
  while (queue.length && read < maxSitemaps && entries.size < maxUrls) {
    const sm = queue.shift(); if (seen.has(sm)) continue; seen.add(sm);
    try {
      const { text } = await getText(fetchFn, sm, 10 * 1024 * 1024); read++;
      if (!/<(urlset|sitemapindex)\b/i.test(text)) continue;
      foundSitemap = true;
      const { children, urls } = parseSitemap(text);
      // Prima le sitemap di articoli, news e prodotti; tralascia immagini e tassonomie.
      const rank = u => /post|news|press|event|product|prodott|page/i.test(u) ? 0 : /tag|categor|author|image|video|attachment|taxonom/i.test(u) ? 2 : 1;
      queue.push(...children.filter(c => rank(c) < 2).sort((a, b) => rank(a) - rank(b)));
      for (const u of urls.slice(0, maxUrls)) add(u, 'sitemap');
      if (sitemapRoots.length === 3 && !children.length && urls.length) break; // trovata una sitemap standard: basta
    } catch {}
  }
  if (foundSitemap) methods.push('sitemap');
  if (!methods.some(m => m !== 'homepage')) errors.push('No structured source found (WordPress API, RSS or sitemap): only the homepage will be read.');

  // Le voci di menu valgono come pagine (utile per siti senza sitemap).
  for (const s of profile.sections) add({ url: s.url, title: s.label }, 'menu');
  const list = [...entries.values()].map(e => { const kind = classifyPage(e.url, e.title); return { ...e, kind: kind === 'page' && (e.via === 'wordpress' || e.via === 'rss') ? 'news' : kind }; });
  return { profile, entries: list, methods, errors };
}

// Legge una pagina nuova per ottenere titolo e testo (per riconoscere fiere e prodotti).
export async function readPage(url, fetchFn) {
  const { text, type } = await getText(fetchFn, url);
  if (!/html|xml|text/i.test(type)) return null;
  const p = extractPreview(text, url);
  const title = strip(text.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '', 300);
  const desc = decode(attr((text.match(/<meta\b[^>]*name=["']description["'][^>]*>/i) || [''])[0], 'content') || '');
  const main = text.match(/<(main|article)\b[\s\S]*?<\/\1>/i)?.[0] || text.replace(/<(nav|header|footer)\b[\s\S]*?<\/\1>/gi, ' ');
  const published = attr((text.match(/<meta\b[^>]*property=["']article:published_time["'][^>]*>/i) || [''])[0], 'content') || text.match(/<time\b[^>]*datetime=["']([^"']+)/i)?.[1] || null;
  return { title: title || p.title, summary: (desc ? desc + ' — ' : '') + strip(main, 3500), publishedAt: p.published || okDate(published), image: p.image, lead: p.lead };
}
