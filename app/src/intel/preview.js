// Anteprima di un articolo: immagine di copertina e "di cosa parla"
// (2-3 frasi significative dal testo, preferendo quelle che citano l'azienda).

const decode = s => String(s ?? '')
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
  .replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&[a-z]+;/gi, ' ');
const attr = (tag, name) => tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'))?.slice(2).find(v => v !== undefined) ?? null;
const textOf = html => decode(html.replace(/<(script|style|noscript|svg|form|button|select)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
  .replace(/<\/(p|div|li|h[1-6]|br|section|article|td)>/gi, '. ').replace(/<br\s*\/?>/gi, '. ').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').replace(/(\.\s*){2,}/g, '. ').trim();

const JUNK = /cookie|javascript|newsletter|subscribe|iscriviti|abbonati|log ?in|sign ?in|privacy|all rights reserved|tutti i diritti|copyright|©|share this|condividi|leggi anche|read more|related articles|advertis|pubblicit|skip to|vai al contenuto|accept|accetta|menu|search|cerca nel sito/i;

export const isAccessWall = text => /(?:welcome back|continue to join|join or sign in|to view or add a comment|never miss a beat on the app|agree to LinkedIn[’']s User|new to linkedin|sign in to view)/i.test(String(text||''));

function sentences(text) {
  return String(text || '').replace(/\s+/g, ' ')
    .split(/(?<=[.!?。！？])\s+(?=[A-ZÀ-ÖØ-Þ0-9"“«(\p{Script=Han}])/u)
    .map(s => s.trim()).filter(s => s.length >= 50 && s.length <= 420 && /\p{L}{3}/u.test(s) && !JUNK.test(s) && (s.match(/\p{L}+/gu) || []).length >= 8);
}

// Lead: dalla prima frase che cita l'azienda (se c'è), altrimenti dall'inizio; massimo ~460 caratteri.
export function leadFromText(text, names = [], max = 460) {
  const list = sentences(text);
  if (!list.length) { const t = String(text || '').replace(/\s+/g, ' ').trim(); if(isAccessWall(t))return ''; return t.length > max ? t.slice(0, max).replace(/\s+\S*$/, '') + '…' : t; }
  const norm = s => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const n = names.filter(Boolean).map(norm);
  let start = n.length ? list.findIndex(s => n.some(x => norm(s).includes(x))) : -1;
  if (start < 0 || start > 12) start = 0;
  let out = '';
  for (const s of list.slice(start)) { if ((out + ' ' + s).length > max) break; out = (out ? out + ' ' : '') + s; if (out.length > max * 0.6) break; }
  return out || list[start].slice(0, max);
}

export function extractPreview(html, url, names = []) {
  const head = String(html).slice(0, 300000);
  const meta = keys => {
    for (const tag of head.match(/<meta\b[^>]*>/gi) || []) {
      const key = (attr(tag, 'property') || attr(tag, 'name') || '').toLowerCase();
      if (keys.includes(key)) { const v = decode(attr(tag, 'content') || '').trim(); if (v) return v; }
    }
    return '';
  };
  let image = meta(['og:image', 'og:image:url', 'og:image:secure_url', 'twitter:image', 'twitter:image:src']);
  const main = html.match(/<article\b[\s\S]*?<\/article>/i)?.[0] || html.match(/<main\b[\s\S]*?<\/main>/i)?.[0]
    || html.replace(/<(nav|header|footer|aside)\b[\s\S]*?<\/\1>/gi, ' ');
  if (!image) {
    for (const tag of main.match(/<img\b[^>]*>/gi) || []) {
      const src = attr(tag, 'src') || attr(tag, 'data-src') || attr(tag, 'data-lazy-src');
      const w = +(attr(tag, 'width') || 0);
      if (src && !/logo|icon|avatar|sprite|pixel|blank|spacer|\.svg|data:/i.test(src) && (!w || w >= 200)) { image = src; break; }
    }
  }
  try { image = image ? new URL(decode(image), url).href : ''; } catch { image = ''; }
  if (image && !/^https?:/i.test(image)) image = '';
  const rawDescription = meta(['og:description', 'description', 'twitter:description']);
  const description = isAccessWall(rawDescription) ? '' : rawDescription;
  const title = meta(['og:title', 'twitter:title']) || textOf(head.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '');
  const body = textOf(main);
  const lead = leadFromText(body, names) || description;
  const found = findPublishedDate(html, url);
  const published = found?.date || '';
  return { image: image.slice(0, 1000), description: description.slice(0, 600), lead: (lead.length >= 80 ? lead : [description, lead].filter(Boolean).join(' — ')).slice(0, 700), title: title.slice(0, 300), text: body.slice(0, 16000), published, publishedHow: found?.how || '' };
}

// ---- Data di pubblicazione ----
const MONTHS = { jan:1,january:1,gen:1,gennaio:1,januar:1,janvier:1,feb:2,february:2,febbraio:2,februar:2,fevrier:2,février:2,mar:3,march:3,marzo:3,märz:3,mars:3,apr:4,april:4,aprile:4,avril:4,may:5,maggio:5,mai:5,mag:5,jun:6,june:6,giugno:6,juni:6,juin:6,giu:6,jul:7,july:7,luglio:7,juli:7,juillet:7,lug:7,aug:8,august:8,agosto:8,ago:8,août:8,aout:8,sep:9,sept:9,september:9,settembre:9,set:9,septembre:9,oct:10,october:10,ottobre:10,oktober:10,octobre:10,ott:10,nov:11,november:11,novembre:11,dec:12,december:12,dicembre:12,dezember:12,décembre:12,decembre:12,dic:12 };
const monthRe = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|');
const validIso = (y, m, d) => { y = +y; m = +m; d = +d || 1; if (y < 1995 || m < 1 || m > 12 || d < 1 || d > 31) return null; const t = Date.UTC(y, m - 1, d, 12); return t > Date.now() + 2 * 86400000 ? null : new Date(t).toISOString(); };
const okIso = v => { if (!v) return null; const t = Date.parse(v); if (!Number.isFinite(t) || t > Date.now() + 2 * 86400000 || t < Date.UTC(1995, 0, 1)) return null; return new Date(t).toISOString(); };

// Data di un post LinkedIn: l'ID dell'attività contiene il timestamp (primi 41 bit).
export function linkedinDate(url) {
  const id = String(url || '').match(/(?:activity|share|ugcPost)[-:](\d{19})/i)?.[1];
  if (!id) return null;
  try { return okIso(new Date(Number(BigInt(id) >> 22n)).toISOString()); } catch { return null; }
}

export function findPublishedDate(html = '', url = '') {
  const li = linkedinDate(url); if (li) return { date: li, how: 'LinkedIn post ID' };
  const head = String(html).slice(0, 400000);
  // 1. JSON-LD
  const ld = head.match(/"datePublished"\s*:\s*"([^"]+)"/i)?.[1] || head.match(/"uploadDate"\s*:\s*"([^"]+)"/i)?.[1];
  if (okIso(ld)) return { date: okIso(ld), how: 'page structured data' };
  // 2. meta
  for (const tag of head.match(/<meta\b[^>]*>/gi) || []) {
    const key = (attr(tag, 'property') || attr(tag, 'name') || attr(tag, 'itemprop') || '').toLowerCase();
    if (/^(article:published_time|og:published_time|datepublished|date|pubdate|publishdate|publish-date|publication_date|dc\.date|dc\.date\.issued|dcterms\.created|dcterms\.issued|sailthru\.date|parsely-pub-date|citation_publication_date|citation_date)$/.test(key)) {
      const v = decode(attr(tag, 'content') || '').trim();
      const d = okIso(v) || okIso(v.replace(/\//g, '-'));
      if (d) return { date: d, how: 'page metadata' };
    }
  }
  // 3. <time datetime>
  const t = head.match(/<time\b[^>]*datetime=["']([^"']+)/i)?.[1];
  if (okIso(t)) return { date: okIso(t), how: 'date shown in the page' };
  // 4. data nell'indirizzo
  const u = String(url).match(/\/(20\d\d|199\d)[/-](0[1-9]|1[0-2])(?:[/-](0[1-9]|[12]\d|3[01]))?(?:[/-]|$)/);
  if (u) { const d = validIso(u[1], u[2], u[3]); if (d) return { date: d, how: 'date in the address' }; }
  // 5. testo vicino a "pubblicato / published / posted"
  const text = textOf(head).slice(0, 6000);
  const near = text.match(new RegExp(`(?:pubblicat[oa]|published|posted|data|date|veröffentlicht|publié|aggiornat[oa]|updated)\\s*(?:il|on|:|am|le)?\\s*(\\d{1,2})[\\s./-]*(${monthRe}|\\d{1,2})[\\s.,/-]*(\\d{4})`, 'i'))
    || text.match(new RegExp(`(?:published|posted|pubblicato)\\s*(?:on)?\\s*(${monthRe})\\.?\\s+(\\d{1,2}),?\\s+(\\d{4})`, 'i'));
  if (near) {
    let y, m, d;
    if (/^\d/.test(near[1])) { d = near[1]; m = MONTHS[near[2].toLowerCase()] || near[2]; y = near[3]; } else { m = MONTHS[near[1].toLowerCase()]; d = near[2]; y = near[3]; }
    const iso = validIso(y, m, d); if (iso) return { date: iso, how: 'date in the text' };
  }
  return null;
}

// Anni citati nel testo: servono a capire se un articolo senza data parla di fatti vecchi.
export function yearsIn(text) { return [...new Set((String(text || '').match(/\b(19[89]\d|20[0-3]\d)\b/g) || []).map(Number))].filter(y => y <= new Date().getFullYear()).sort(); }
