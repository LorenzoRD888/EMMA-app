import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { openMarket } from '../src/market-store.js';
import { createMarketService } from '../src/market-service.js';
import { marketRoutes } from '../src/market-routes.js';
import { detectEvent, eventStatus, extractDates } from '../src/intel/fairs.js';
import { parseSitemap, parseFeed, classifyPage, siteProfile } from '../src/intel/site-watch.js';

const withStore = async fn => { const folder = await mkdtemp(path.join(os.tmpdir(), 'emma-intel-')); const store = openMarket(path.join(folder, 't.sqlite')); try { await fn(store, folder); } finally { store.close(); await rm(folder, { recursive: true, force: true }); } };
const settings = { snapshot: () => ({ provider: 'local', localModel: 'test', configured: {} }), client: () => ({ messages: { create: async () => ({ content: [{ text: '{}' }] }) } }) };
const done = async service => { for (let i = 0; i < 300 && service.job()?.status === 'running'; i++) await new Promise(r => setTimeout(r, 10)); };

// Sito finto in stile WordPress, modificabile tra una scansione e l'altra.
function fakeSite() {
  const site = {
    posts: [
      { date: '2026-03-01T09:00:00', link: 'https://www.alphafilm.example/alphafilm-at-coiltech-deutschland-2026/', title: { rendered: 'Alphafilm at Coiltech Deutschland 2026' }, excerpt: { rendered: '<p>Meet us in Augsburg, Hall 1, Stand A24.</p>' } },
      { date: '2025-06-01T09:00:00', link: 'https://www.alphafilm.example/alphafilm-at-intersolar-europe-2025/', title: { rendered: 'ALPHAFILM at Intersolar Europe 2025' }, excerpt: { rendered: 'Booth B2.410, May 7–9, 2025' } },
    ],
    pages: ['https://www.alphafilm.example/photovoltaic/', 'https://www.alphafilm.example/electrical-insulation/', 'https://www.alphafilm.example/wp-content/uploads/dyeco-datasheet.pdf'],
  };
  const home = `<html lang="it"><head><title>ALPHAFILM - The Value Of Innovation</title><meta name="description" content="Alphafilm produces polyester films for photovoltaic backsheets, electrical insulation and labelling."></head>
   <body><header><nav><a href="/photovoltaic/">Photovoltaic</a><a href="/electrical-insulation/">Electrical Insulation</a><a href="/labelling/">Labelling</a><a href="/news/">News</a><a href="/privacy-policy/">Privacy</a></nav></header></body></html>`;
  const res = (body, type = 'text/html') => new Response(body, { status: 200, headers: { 'content-type': type } });
  const fetchFn = async url => {
    const u = new URL(url);
    if (u.pathname === '/it' || u.pathname === '/') return res(home);
    if (u.pathname === '/wp-json/wp/v2/posts') return res(JSON.stringify(site.posts), 'application/json');
    if (u.pathname === '/robots.txt') return res('User-agent: *\nSitemap: https://www.alphafilm.example/sitemap_index.xml', 'text/plain');
    if (u.pathname === '/sitemap_index.xml') return res('<sitemapindex><sitemap><loc>https://www.alphafilm.example/page-sitemap.xml</loc></sitemap><sitemap><loc>https://www.alphafilm.example/category-sitemap.xml</loc></sitemap></sitemapindex>', 'application/xml');
    if (u.pathname === '/page-sitemap.xml') return res('<urlset>' + site.pages.map(p => `<url><loc>${p}</loc><lastmod>2024-01-01</lastmod></url>`).join('') + '</urlset>', 'application/xml');
    if (u.pathname === '/category-sitemap.xml') throw new Error('should be skipped');
    if (u.pathname.startsWith('/alphafilm-exhibits-snec')) return res('<html><head><title>SNEC</title></head><body><article><h1>Alphafilm exhibits at SNEC 2027</h1><p>Visit our booth 7.2H-E610, June 2-4, 2027 in Shanghai.</p></article></body></html>');
    if (u.pathname.startsWith('/alphafilm-at')) return res('<html><body><article><h1>post</h1><p>Hall 1, Stand A24</p></article></body></html>');
    if (u.pathname === '/backsheet-new-series/') return res('<html><head><meta name="description" content="New fluorine-free backsheet"></head><body><h1>Alphamat New Series</h1></body></html>');
    return new Response('not found', { status: 404 });
  };
  return { site, fetchFn };
}

test('fair recognition: catalog, booth, dates, unknown fairs, no false positives', () => {
  const e = detectEvent({ title: 'Alphafilm at Coiltech Deutschland 2026', summary: 'Hall 1, Stand A24' });
  assert.equal(e.fairKey, 'coiltech-deutschland'); assert.equal(e.booth, 'Hall 1 · Stand A24'); assert.equal(e.year, 2026);
  assert.deepEqual(extractDates('dal 8 al 15 ottobre 2025'), { start: '2025-10-08', end: '2025-10-15' });
  assert.deepEqual(extractDates('June 23–25, 2026'), { start: '2026-06-23', end: '2026-06-25' });
  assert.equal(detectEvent({ title: 'Alphafilm presenta i risultati 2025', summary: 'Prodotti che fanno la differenza: stand out' }), null);
  assert.equal(detectEvent({ title: 'Alphafilm at Battery Expo Jakarta 2026', summary: 'Visit our booth 3-45' }).inCatalog, false);
  assert.equal(detectEvent({ title: 'Alphafilm 参加 SNEC 2026 展会', summary: '展位号：7.2H-E610' }).fairKey, 'snec');
  assert.equal(eventStatus({ fairKey: 'x', year: 2027 }, '2026-10-28'), 'upcoming');
  assert.equal(eventStatus({ fairKey: 'x', endDate: '2026-06-25' }, '2026-10-28'), 'past');
});

test('site parsing: sitemap, feed, page kinds, menu profile', () => {
  const sm = parseSitemap('<urlset><url><loc>https://a.example/x</loc><lastmod>2026-01-02</lastmod></url></urlset>');
  assert.equal(sm.urls[0].lastmod, '2026-01-02');
  const feed = parseFeed('<rss><channel><item><title><![CDATA[Nuovo prodotto]]></title><link>https://a.example/n</link><pubDate>Mon, 05 Oct 2026 10:00:00 GMT</pubDate></item></channel></rss>');
  assert.equal(feed[0].title, 'Nuovo prodotto');
  assert.equal(classifyPage('https://a.example/download/tds-x.pdf'), 'document');
  assert.equal(classifyPage('https://a.example/careers/chemist'), 'career');
  assert.equal(classifyPage('https://a.example/news/launch'), 'news');
  const p = siteProfile('<title>A</title><nav><a href="/films/">Polyester films</a><a href="https://other.example/x">Out</a></nav>', 'https://a.example/');
  assert.deepEqual(p.sections.map(s => s.label), ['Polyester films']);
});

test('official site: baseline first, then only new pages; fairs from posts; radar and dossier', () => withStore(async store => {
  const { site, fetchFn } = fakeSite();
  const c = store.saveCompany({ name: 'Alphafilm', website: 'https://www.alphafilm.example/it' });
  const service = createMarketService(store, settings, { fetchSite: fetchFn, search: async () => [], papers: async () => [], patents: async () => [] });
  const first = await service.intel.scan(c, { force: true });
  assert.ok(first.site.methods.includes('wordpress') && first.site.methods.includes('sitemap'));
  assert.equal(first.newPages, 0, 'la prima scansione è la base di confronto');
  const events = service.intel.dossier(c.id).events;
  assert.deepEqual(events.map(e => e.fairKey).sort(), ['coiltech-deutschland', 'intersolar-europe']);
  assert.equal(events.find(e => e.fairKey === 'coiltech-deutschland').booth, 'Hall 1 · Stand A24');
  assert.ok(events.every(e => e.official));
  assert.ok(service.intel.intelOf(c.id).terms.includes('photovoltaic'));
  assert.equal(service.intel.radar({ days: 7 }).items.length, 0);
  assert.equal(service.intel.dossier(c.id).pageCounts.document, 1);

  site.posts.unshift({ date: new Date().toISOString(), link: 'https://www.alphafilm.example/alphafilm-exhibits-snec-2027/', title: { rendered: 'Alphafilm exhibits at SNEC 2027' }, excerpt: { rendered: '' } });
  site.pages.push('https://www.alphafilm.example/backsheet-new-series/');
  const second = await service.intel.scan(c, { force: true });
  assert.equal(second.newPages, 2);
  const radar = service.intel.radar({ days: 7 });
  assert.equal(radar.counts.site, 2); assert.equal(radar.counts.event, 1);
  const snec = radar.items.find(i => i.type === 'event').event;
  assert.equal(snec.fairKey, 'snec'); assert.equal(snec.booth, 'Stand 7.2H-E610'); assert.equal(snec.startDate, '2027-06-02'); assert.equal(snec.status, 'upcoming');
  assert.equal(radar.items.find(i => i.url.includes('backsheet-new-series')).title, 'Alphamat New Series');
  assert.equal(service.intel.fairsBoard().upcoming.length, 1);
}));

test('homonyms: social rejected, no sector context goes to review, context accepted; review can be resolved', () => withStore(async store => {
  const previous = process.env.TAVILY_API_KEY; process.env.TAVILY_API_KEY = 'test-only';
  try {
    const { fetchFn } = fakeSite();
    const c = store.saveCompany({ name: 'Alphafilm', website: 'https://www.alphafilm.example/it', excludeTerms: 'lyrics' });
    const search = async (query) => /booth|fiera|fair/.test(query) ? [
      { url: 'https://pv-magazine.example/snec-exhibitors', title: 'Alphafilm at SNEC 2027', summary: 'Alphafilm will show backsheets at booth E610.' },
    ] : [
      { url: 'https://www.facebook.com/groups/1/posts/2', title: 'Sevie singer from Greece', summary: 'second single from our album "Alphafilm"' },
      { url: 'https://musicblog.example/alphafilm', title: 'Alphafilm: the new album', summary: 'Sevie presents Alphafilm' },
      { url: 'https://lyrics.example/alphafilm', title: 'Alphafilm lyrics', summary: 'Alphafilm lyrics' },
      { url: 'https://trade.example/backsheet', title: 'Alphafilm expands photovoltaic backsheet capacity', summary: 'Alphafilm invests in a new line' },
    ];
    const service = createMarketService(store, settings, { fetchSite: fetchFn, search, fetchPage: async () => new Response('', { status: 404 }), papers: async () => [], patents: async () => [] });
    service.saveResearch({ mode: 'daily', maxPages: 0, includeChinese: false, includeBaidu: false, resultsPerQuery: 10, freeNews: false });
    service.start({ companyIds: [c.id], days: 7 });
    await done(service);
    const titles = store.query({}).items.map(n => n.title).sort();
    assert.deepEqual(titles, ['Alphafilm at SNEC 2027', 'Alphafilm expands photovoltaic backsheet capacity']);
    const review = store.query({ state: 'review' }).items;
    assert.deepEqual(review.map(n => n.title), ['Alphafilm: the new album']);
    assert.equal(store.stats().review, 1);
    assert.ok(service.intel.dossier(c.id).events.some(e => e.fairKey === 'snec' && !e.official));
    const run = store.stats().runs[0].detail;
    assert.equal(run.review, 1); assert.ok(run.intel.companies[0].methods.includes('wordpress'));
    service.intel.resolveReview(review[0].id, false);
    assert.equal(store.stats().review, 0);
    assert.equal(store.query({ state: 'review' }).total, 0);
  } finally { if (previous === undefined) delete process.env.TAVILY_API_KEY; else process.env.TAVILY_API_KEY = previous; }
}));

test('publications: only first scan is baseline; API exposes radar, fairs and dossier', () => withStore(async store => {
  const { fetchFn } = fakeSite();
  const c = store.saveCompany({ name: 'Alphafilm', website: 'https://www.alphafilm.example/it' });
  let papers = [{ kind: 'paper', url: 'https://doi.org/10.1/old', title: 'Old PET film ageing', publishedAt: '2019-01-01' }];
  const service = createMarketService(store, settings, { fetchSite: fetchFn, search: async () => [], papers: async () => papers, patents: async () => [] });
  await service.intel.scan(c, { force: true });
  papers = [...papers, { kind: 'paper', url: 'https://doi.org/10.1/new', title: 'Partial discharge resistant films', publishedAt: '2026-10-01' }];
  await service.intel.scan(c, { force: true });
  assert.equal(service.intel.radar({ types: 'publication' }).items.length, 1);
  const app = express(); app.use(express.json()); app.use('/api', marketRoutes(store, service, settings)); app.use((err, req, res, next) => res.status(err.status || 500).json({ error: err.message }));
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  try {
    assert.equal((await (await fetch(base + '/radar?days=30')).json()).counts.publication, 1);
    assert.equal((await (await fetch(base + '/fairs')).json()).fairs.length, 2);
    const d = await (await fetch(base + '/intel/' + c.id)).json();
    assert.equal(d.publications.length, 2); assert.equal(d.profile.title, 'ALPHAFILM - The Value Of Innovation');
    assert.equal((await fetch(base + '/intel/nope')).status, 404);
    const ev = d.events[0];
    await fetch(base + '/events/' + ev.id + '/hide', { method: 'POST' });
    assert.equal((await (await fetch(base + '/intel/' + c.id)).json()).events.length, 1);
  } finally { await new Promise(r => server.close(r)); }
}));

test('preview: cover image and lead about the company; daily feed grouped by company', () => withStore(async store => {
  const { extractPreview, leadFromText } = await import('../src/intel/preview.js');
  const html = `<html><head><meta property="og:image" content="/img/line.jpg"><meta name="description" content="Short desc"></head><body><nav>Home News Contact</nav><article><h1>New line</h1>
   <p>We use cookies to improve your experience on this website and for analytics.</p>
   <p>The market for solar materials keeps growing in Asia this year according to analysts.</p>
   <p>Alphafilm has inaugurated a new coating line in Zhangjiagang dedicated to fluorine-free backsheets for photovoltaic modules.</p>
   <p>The investment doubles the local capacity and will serve Chinese module makers from early next year onwards.</p></article></body></html>`;
  const p = extractPreview(html, 'https://news.example/a/b', ['Alphafilm']);
  assert.equal(p.image, 'https://news.example/img/line.jpg');
  assert.match(p.lead, /^Alphafilm has inaugurated/);
  assert.doesNotMatch(p.lead, /cookies/);
  assert.equal(leadFromText('', []), '');
  const c = store.saveCompany({ name: 'Alphafilm' }), k = store.saveCompany({ name: 'Betafoil' });
  store.ingest([{ url: 'https://news.example/a/b', title: 'Alphafilm new line', summary: 'x', image: p.image, lead: p.lead, publishedAt: new Date().toISOString() }], c.id);
  store.ingest([{ url: 'https://news.example/old', title: 'Alphafilm opens plant in China', summary: 'In 2011 Alphafilm opened a plant.', publishedAt: '2011-05-01' }, { url: 'https://news.example/nodate', title: 'Alphafilm undated', summary: 'no date' }], c.id);
  store.ingest([{ url: 'https://news.example/k', title: 'Betafoil news', summary: 'Betafoil opens a plant in India for insulation materials, the company said on Monday in a statement.', publishedAt: new Date().toISOString() }], k.id);
  const service = createMarketService(store, settings, { fetchSite: async () => new Response('', { status: 404 }), papers: async () => [], patents: async () => [] });
  const feed = service.intel.dailyFeed('');
  assert.equal(feed.companies.length, 2);
  const item = feed.companies.find(g => g.name === 'Alphafilm').items[0];
  assert.equal(item.image, p.image); assert.match(item.lead, /Zhangjiagang/);
  assert.match(feed.companies.find(g => g.name === 'Betafoil').items[0].lead, /plant in India/);
  assert.equal(feed.missingPreviews, 1);
  assert.deepEqual(feed.skipped, { old: 1, undated: 1 });
  assert.equal(feed.companies.find(g => g.name === 'Alphafilm').items.length, 1);
}));

test('LinkedIn people/posts parsing and key facts extraction', async () => {
  const { parseProfile, parsePost, parseCompanyPage } = await import('../src/intel/social.js');
  const { extractFacts } = await import('../src/intel/facts.js');
  const c = { name: 'Alphafilm', aliases: [] };
  const p = parseProfile({ url: 'https://it.linkedin.com/in/mario-rossi-123?trk=x', title: 'Mario Rossi - R&D Manager - Alphafilm | LinkedIn', summary: 'Esperienza: Alphafilm · Formazione: Università di Bologna · Località: Bologna · 500+ collegamenti' }, c);
  assert.equal(p.name, 'Mario Rossi'); assert.equal(p.role, 'R&D Manager'); assert.equal(p.location, 'Bologna'); assert.equal(p.current, true); assert.equal(p.url, 'https://it.linkedin.com/in/mario-rossi-123');
  assert.equal(parseProfile({ url: 'https://linkedin.com/in/x', title: 'Anna Bianchi - Sales - Other Spa | LinkedIn', summary: '' }, c), null);
  assert.equal(parseProfile({ url: 'https://linkedin.com/in/y', title: 'Luca Verdi - Export Manager presso Alphafilm S.p.A. | LinkedIn', summary: '' }, c).role, 'Export Manager');
  const post = parsePost({ url: 'https://www.linkedin.com/posts/alphafilm_backsheet-activity-7123', title: 'Alphafilm on LinkedIn: We are proud to present our new fluorine-free backsheet | 12 comments', summary: 'We are proud to present...' }, c);
  assert.equal(post.author, 'Alphafilm'); assert.ok(post.fromCompany); assert.match(post.title, /^Alphafilm: We are proud/);
  assert.equal(parsePost({ url: 'https://www.linkedin.com/posts/someone_x', title: 'Someone on LinkedIn: nice weather', summary: '' }, c), null);
  assert.equal(parseCompanyPage({ url: 'https://it.linkedin.com/company/alphafilm', title: 'Alphafilm | LinkedIn', summary: 'Alphafilm | 12.345 follower su LinkedIn. Dimensioni: 201-500 dipendenti' }, c).followers, '12.345');
  const f = extractFacts({ url: 'https://press.example/alphafilm', title: 'Alphafilm', summary: 'Alphafilm ha chiuso il 2025 con un fatturato di 180 milioni di euro. Il tempo è bello oggi a Bologna con 20 gradi. Alphafilm impiega oltre 500 dipendenti in Italia e in Cina.' }, c);
  assert.deepEqual(f.map(x => x.kind), ['revenue', 'employees']);
});

test('startup discovery parses directories and funding news; facts reject homonyms and keep years', async () => {
  const { discover, candidateFromResult } = await import('../src/intel/discover.js');
  const { validateFact, cleanText } = await import('../src/intel/facts.js');
  const search = async (q, o) => o.domain === 'crunchbase.com' ? [
    { url: 'https://www.crunchbase.com/organization/barrierfilm', title: 'BarrierFilm - Crunchbase Company Profile & Funding', summary: 'BarrierFilm develops recyclable mono-material films. Based in Ghent, Belgium. Founded in 2022.' },
    { url: 'https://www.crunchbase.com/hub/top-film-startups', title: 'Top 50 film startups', summary: '' },
  ] : o.domain === 'tracxn.com' ? [{ url: 'https://tracxn.com/d/companies/barrierfilm/__x', title: 'BarrierFilm - 2025 Company Profile, Team, Funding & Competitors - Tracxn', summary: '' }]
    : o.topic === 'news' ? [{ url: 'https://news.example/x', title: 'Coatix raises €4M seed round for paper coatings', summary: 'Coatix, headquartered in Lyon, ...' }, { url: 'https://news.example/y', title: 'Alphafilm raises €10M', summary: '' }] : [];
  const r = await discover('barrier film', search, { exclude: ['Alphafilm'] });
  assert.deepEqual(r.candidates.map(c => c.name), ['BarrierFilm', 'Coatix']);
  assert.equal(r.candidates[0].sources.length, 2); assert.equal(r.candidates[0].country, 'Ghent'); assert.equal(r.candidates[0].founded, '2022');
  assert.equal(candidateFromResult({ url: 'https://www.linkedin.com/in/someone', title: 'Someone | LinkedIn' }, { topic: 'x' }), null);
  const c = { name: 'Alphafilm', aliases: [] };
  assert.equal(validateFact('OÜ Alphafilm generated less than €1M in revenue for the financial year ending on Dec 31, 2023.', c), null);
  const v = validateFact('## 2011 ##### Opening of backsheet manufacturing plant [...] Alphafilm opens its second manufacturing plant in Zhangjiagang.', c);
  assert.equal(v.year, 2011); assert.doesNotMatch(v.text, /#|\[/);
  assert.equal(cleanText('international mar-kets and in-house prod-ucts'), 'international markets and in-house products');
});

test('daily feed mixes companies by publication date, hides items, and accepts manual news with page reading', () => withStore(async store => {
  const c = store.saveCompany({ name: 'Alphafilm' }), k = store.saveCompany({ name: 'Betafoil' });
  const d = days => new Date(Date.now() - days * 86400000).toISOString();
  store.ingest([{ url: 'https://n.example/a', title: 'Alphafilm A', summary: 'x', publishedAt: d(2) }, { url: 'https://n.example/old', title: 'Alphafilm old', summary: 'x', publishedAt: '2011-01-01' }, { url: 'https://n.example/nodate', title: 'Alphafilm nodate', summary: 'x' }], c.id);
  store.ingest([{ url: 'https://n.example/k', title: 'Betafoil K', summary: 'x', publishedAt: d(1) }], k.id);
  const page = '<html><head><title>Alphafilm launches new film</title><meta property="article:published_time" content="' + d(3) + '"><meta property="og:image" content="https://img.example/a.jpg"></head><body><article><p>Alphafilm launches a new polyester film for electric motors, the company announced in a press release this week.</p></article></body></html>';
  const service = createMarketService(store, settings, { fetchSite: async () => new Response('', { status: 404 }), fetchPage: async () => new Response(page, { headers: { 'content-type': 'text/html' } }), papers: async () => [], patents: async () => [] });
  let f = service.intel.feed({ days: 30 });
  assert.deepEqual(f.items.map(i => i.title), ['Betafoil K', 'Alphafilm A']); assert.equal(f.undated, 1);
  service.intel.hideFromDaily('news', f.items[0].id);
  f = service.intel.feed({ days: 30 });
  assert.deepEqual(f.items.map(i => i.title), ['Alphafilm A']); assert.equal(store.query({ companies: k.id }).total, 1);
  const r = await service.addManualNews({ companyId: c.id, url: 'https://blog.example/alphafilm-film', notes: 'Segnalata da un cliente' });
  assert.equal(r.title, 'Alphafilm launches new film'); assert.ok(r.publishedAt);
  f = service.intel.feed({ days: 30 });
  const m = f.items.find(i => i.url === 'https://blog.example/alphafilm-film');
  assert.equal(m.image, 'https://img.example/a.jpg'); assert.equal(m.foundVia.label, 'Added by you'); assert.equal(m.notes, 'Segnalata da un cliente');
  await assert.rejects(service.addManualNews({ companyId: c.id, url: 'not a url' }));
}));

test('bug review: shared news appears once in the Daily, future manual dates are ignored', () => withStore(async store => {
  const c = store.saveCompany({ name: 'Alphafilm' }), k = store.saveCompany({ name: 'Betafoil' });
  const when = new Date(Date.now() - 86400000).toISOString();
  store.ingest([{ url: 'https://n.example/both', title: 'Alphafilm and Betafoil deal', summary: 'x', publishedAt: when }], c.id);
  store.ingest([{ url: 'https://n.example/both', title: 'Alphafilm and Betafoil deal', summary: 'x', publishedAt: when }], k.id);
  const service = createMarketService(store, settings, { fetchSite: async () => new Response('', { status: 404 }), fetchPage: async () => new Response('<html><head><title>Alphafilm page</title></head><body><p>Alphafilm text</p></body></html>', { headers: { 'content-type': 'text/html' } }), papers: async () => [], patents: async () => [] });
  const f = service.intel.feed({ days: 30 });
  assert.equal(f.items.filter(i => i.url === 'https://n.example/both').length, 1);
  assert.equal(f.items[0].otherCompanies.length, 1);
  const r = await service.addManualNews({ companyId: c.id, url: 'https://blog.example/future', publishedAt: '2999-01-01' });
  assert.equal(r.publishedAt, null);
}));
