import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openMarket } from '../src/market-store.js';
import { createMarketService } from '../src/market-service.js';
import { googleNews, bingNews, gdeltNews, orQuery, newsLanguages } from '../src/intel/free-news.js';
import { detectBrands, productNames, mentionsProduct } from '../src/intel/products.js';
import { researchPlan, RESEARCH_DEFAULTS, validateResearch } from '../src/research-plan.js';

process.env.EMMA_GDELT_GAP = '0';
const ago = d => new Date(Date.now() - d * 86400000);
const res = (body, type) => new Response(body, { headers: { 'content-type': type } });
const GOOGLE = `<rss><channel><item><title>Alphafilm expands backsheet plant - PV Magazine</title><link>https://news.google.com/rss/articles/abc</link><pubDate>${ago(2).toUTCString()}</pubDate><source url="https://pv-magazine.com">PV Magazine</source></item><item><title>Alphamat backsheet now at European distributor - Solar News</title><link>https://news.google.com/rss/articles/def</link><pubDate>${ago(3).toUTCString()}</pubDate><source url="https://solar.example">Solar News</source></item></channel></rss>`;
const BING = `<rss><channel><item><title>Alphafilm opens US office for backsheet sales</title><link>http://www.bing.com/news/apiclick.aspx?ref=FexRss&amp;url=https%3a%2f%2fnews.example%2falphafilm-us</link><description>The backsheet maker Alphafilm opened an office.</description><pubDate>${ago(1).toUTCString()}</pubDate></item></channel></rss>`;
const GDELT = JSON.stringify({ articles: [{ url: 'https://world.example/alphafilm', title: 'Alphafilm backsheet results', seendate: '20261101T101500Z', domain: 'world.example', language: 'English' }] });
const fetchNews = async url => /news\.google/.test(url) ? res(GOOGLE, 'application/rss+xml') : /bing\.com/.test(url) ? res(BING, 'application/rss+xml') : /gdelt/.test(url) ? res(GDELT, 'application/json') : new Response('no', { status: 404 });

test('free news parsers: Google News, Bing (real address), GDELT', async () => {
  const g = await googleNews('"Alphafilm"', { fetchFn: fetchNews });
  assert.equal(g.length, 2); assert.equal(g[0].title, 'Alphafilm expands backsheet plant'); assert.equal(g[0].source, 'PV Magazine'); assert.ok(g[0].publishedAt); assert.equal(g[0].noRead, true);
  const b = await bingNews('"Alphafilm"', { fetchFn: fetchNews });
  assert.equal(b[0].url, 'https://news.example/alphafilm-us');
  const d = await gdeltNews('"Alphafilm"', { fetchFn: fetchNews });
  assert.equal(d[0].publishedAt, '2026-11-01T10:15:00Z');
  assert.equal(orQuery(['Alphafilm', 'Alphamat', 'Alphafilm']), '"Alphafilm" OR "Alphamat"');
  assert.deepEqual(newsLanguages({ country: 'Italia' }), ['en', 'it']);
  assert.deepEqual(newsLanguages({ country: '' }, { includeChinese: true }), ['en'], 'no Chinese for a company without a Chinese name');
  assert.deepEqual(newsLanguages({ country: '', aliases: ['示例'] }, { includeChinese: true }), ['en', 'zh']);
});

test('product names: yours first, detected brands only if they appear on the official website', async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'emma-prod-')); const store = openMarket(path.join(folder, 'm.sqlite'));
  try {
    const c = store.saveCompany({ name: 'Alphafilm', website: 'https://www.alphafilm.example', products: 'Alphamat, DyFlex' });
    store.ingest([{ url: 'https://n.example/1', title: 'Alphafilm DyBond® and Teflon® laminates', summary: 'DyBond® is new', publishedAt: ago(5).toISOString() }], c.id);
    store.db.prepare("INSERT INTO site_pages(id,companyId,url,title,summary,kind,via,firstSeen,updatedAt,baseline) VALUES('p1',?,'https://www.alphafilm.example/dybond-laminates/','DyBond','','product','sitemap',?,?,1)").run(c.id, new Date().toISOString(), new Date().toISOString());
    assert.deepEqual(detectBrands(store.db, store.company(c.id)).map(b => b.name), ['DyBond']);
    const p = productNames(store.db, store.company(c.id));
    assert.deepEqual(p.mine, ['Alphamat', 'DyFlex']); assert.deepEqual(p.auto, ['DyBond']);
    assert.ok(mentionsProduct('New ALPHAMAT range', ['Alphamat'])); assert.ok(!mentionsProduct('alphamatic', ['Alphamat']));
    const plan = researchPlan({ ...store.company(c.id), productsMine: p.mine, productsAuto: p.auto, keywords: 'backsheet' }, { ...RESEARCH_DEFAULTS, mode: 'wide' }, { tavily: true });
    assert.ok(plan.tasks.some(t => t.query === '"Alphamat" backsheet'));
    assert.ok(plan.tasks.some(t => t.query === '"Alphafilm" "DyBond"'));
    assert.equal(validateResearch({}).freeNews, true); assert.equal(validateResearch({ freeNews: false }).freeNews, false);
  } finally { store.close(); await rm(folder, { recursive: true, force: true }); }
});

test('update uses free news sources and finds product articles that do not name the company', async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'emma-free-')); const store = openMarket(path.join(folder, 'm.sqlite'));
  try {
    const c = store.saveCompany({ name: 'Alphafilm', website: 'https://www.alphafilm.example', keywords: 'backsheet', country: 'Italia', products: 'Alphamat' });
    const settings = { snapshot: () => ({ provider: 'none', configured: {} }), client: () => { throw Error('no'); } };
    const service = createMarketService(store, settings, { fetchSite: async () => new Response('', { status: 404 }), fetchPage: async () => new Response('', { status: 404 }), fetchNews, papers: async () => [], patents: async () => [], people: async () => ({ people: [], errors: [] }), posts: async () => ({ posts: [], errors: [] }), facts: async () => ({ facts: [], leaders: [], errors: [] }), search: async () => [] });
    service.saveResearch({ mode: 'daily', maxPages: 0, includeChinese: false, includeBaidu: false, resultsPerQuery: 10 });
    service.start({ companyIds: [c.id], days: 7 });
    for (let i = 0; i < 300 && service.job()?.status === 'running'; i++) await new Promise(r => setTimeout(r, 10));
    const rows = store.db.prepare('SELECT url,title,foundVia,review FROM news').all();
    const titles = rows.map(r => r.title).sort();
    assert.ok(titles.includes('Alphamat backsheet now at European distributor'), 'product article without the company name');
    assert.ok(titles.includes('Alphafilm opens US office for backsheet sales'));
    assert.ok(titles.includes('Alphafilm backsheet results'));
    assert.ok(rows.some(r => /Google News.* · free source/.test(r.foundVia)));
    const audit = JSON.parse(store.db.prepare('SELECT detail FROM runs').get().detail).audit.filter(e => e.scope === 'Free news source');
    assert.deepEqual(audit.map(e => e.engine), ['Google News', 'Google News (it)', 'Bing News', 'GDELT (world news archive)']);
  } finally { store.close(); await rm(folder, { recursive: true, force: true }); }
});

test('search plan: local language only for non-English countries, Chinese only with a Chinese name', async () => {
  const { researchPlan, RESEARCH_DEFAULTS } = await import('../src/research-plan.js');
  const opts = { ...RESEARCH_DEFAULTS, mode: 'wide', includeChinese: true };
  const labels = c => researchPlan({ id: 'x', name: 'Acme', aliases: [], keywords: 'film', feeds: [], ...c }, opts, { tavily: true }).tasks.map(t => t.label);
  const us = labels({ country: 'USA' });
  assert.ok(!us.some(l => /Italian|Chinese|German/.test(l))); assert.ok(us.includes('Press releases'));
  assert.ok(labels({ country: 'Italia' }).includes('Italian sources'));
  assert.ok(labels({ country: 'Germany' }).includes('German sources'));
  assert.ok(labels({ country: 'USA', aliases: ['艾克米'] }).includes('Chinese sources and queries'));
  assert.ok(labels({ country: 'China' }).includes('Chinese sources and queries'));
});
