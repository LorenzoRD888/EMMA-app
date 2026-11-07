import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openMarket } from '../src/market-store.js';
import { createMarketService } from '../src/market-service.js';
import { pageLines, diffLines } from '../src/intel/key-pages.js';
import { alertMessage } from '../src/notify.js';
import { STRATEGIC_EVENT_TYPES } from '../src/intel/strategic-events.js';

const settings = { snapshot: () => ({ provider: 'none', configured: {} }), client: () => { throw Error('no AI'); } };
const withStore = async fn => { const folder = await mkdtemp(path.join(os.tmpdir(), 'emma-alerts-')); const store = openMarket(path.join(folder, 'm.sqlite')); try { await fn(store); } finally { store.close(); await rm(folder, { recursive: true, force: true }); } };
const ago = d => new Date(Date.now() - d * 86400000).toISOString();

test('page text ignores scripts, menus and noise; diff lists added and removed lines', () => {
  const a = pageLines('<html><nav>Menu Home</nav><script>var t=1</script><h1>Price list</h1><p>Alphamat PYE 350 – € 12,50</p><p>14:32</p><p>© 2026 Alphafilm</p><footer>Cookies</footer></html>');
  assert.deepEqual(a, ['Price list', 'Alphamat PYE 350 – € 12,50']);
  const b = pageLines('<h1>Price list</h1><p>Alphamat PYE 350 – € 13,10</p><p>Alphamat NEW 200 – € 9,90</p>');
  assert.deepEqual(diffLines(a, b), { added: ['Alphamat PYE 350 – € 13,10', 'Alphamat NEW 200 – € 9,90'], removed: ['Alphamat PYE 350 – € 12,50'] });
});

test('watched page: first read is a baseline, then changes appear in the Signal Center', () => withStore(async store => {
  let html = '<h1>Products</h1><p>Film A</p><p>Film B</p>';
  const c = store.saveCompany({ name: 'Alphafilm', website: 'https://www.alphafilm.example' });
  const service = createMarketService(store, settings, { fetchPage: async () => new Response(html, { headers: { 'content-type': 'text/html' } }), notify: async () => true });
  const { page, result } = await service.keyPages.add(c.id, { url: 'https://www.alphafilm.example/en/products', label: 'Products' });
  assert.equal(result.baseline, true);
  assert.equal((await service.keyPages.check(page.id)).changed, false);
  html = '<h1>Products</h1><p>Film A</p><p>Film C new</p>';
  const r = await service.keyPages.check(page.id);
  assert.equal(r.changed, true); assert.deepEqual(r.change.added, ['Film C new']); assert.deepEqual(r.change.removed, ['Film B']);
  const s = service.intel.signals({ days: 7 });
  assert.equal(s.items[0].kind, 'change'); assert.equal(s.items[0].title, 'Products changed');
  service.intel.hideFromDaily('change', s.items[0].id);
  assert.equal(service.intel.signals({ days: 7 }).items.length, 0);
  await assert.rejects(service.keyPages.add(c.id, { url: 'https://www.alphafilm.example/en/products' }), /already watched/);
}));

test('a correction is applied to similar articles and reused for future ones', () => withStore(async store => {
  const c = store.saveCompany({ name: 'Gammapaper', website: 'https://gammapaper.example' });
  store.ingest([
    { url: 'https://a.example/1', title: 'Gammapaper opens new coating line for paper cups', summary: '', publishedAt: ago(2) },
    { url: 'https://b.example/2', title: 'Gammapaper opens new coating line for paper cups in France', summary: '', publishedAt: ago(2) },
    { url: 'https://c.example/3', title: 'Spicers partners with Gammapaper', summary: '', publishedAt: ago(2) },
  ], c.id);
  const id = store.db.prepare("SELECT id FROM news WHERE url='https://a.example/1'").get().id;
  const r = store.correctEvent(id, 'product_launch');
  assert.equal(r.similar, 1);
  const rows = Object.fromEntries(store.db.prepare('SELECT url,eventType,eventBy,confidence FROM news').all().map(x => [x.url, x]));
  assert.equal(rows['https://a.example/1'].eventBy, 'you'); assert.equal(rows['https://a.example/1'].confidence, 'high');
  assert.equal(rows['https://b.example/2'].eventType, 'product_launch'); assert.equal(rows['https://b.example/2'].eventBy, 'learned');
  assert.equal(rows['https://c.example/3'].eventType, 'partnership');
  store.correctEvent(store.db.prepare("SELECT id FROM news WHERE url='https://c.example/3'").get().id, '');
  store.ingest([{ url: 'https://d.example/4', title: 'Spicers partners with Gammapaper!', summary: '', publishedAt: ago(1) }], c.id);
  assert.equal(store.db.prepare("SELECT eventType FROM news WHERE url='https://d.example/4'").get().eventType, '');
  store.ingest([{ url: 'https://c.example/3', title: 'Spicers partners with Gammapaper', summary: '' }], c.id);
  assert.equal(store.db.prepare("SELECT eventType FROM news WHERE url='https://c.example/3'").get().eventType, '', 'a re-found article keeps your correction');
  assert.throws(() => store.correctEvent(id, 'nonsense'), /Unknown event type/);
  const s = createMarketService(store, settings).intel.signals({ days: 30 });
  assert.equal(s.items.find(i => i.eventType === 'product_launch').status, 'checked by you');
}));

test('Mac alerts after an update: priority only by default, never twice, every move when chosen', () => withStore(async store => {
  const sent = [];
  const c = store.saveCompany({ name: 'Gammapaper', website: 'https://gammapaper.example', watchEvents: ['partnership'] });
  const service = createMarketService(store, settings, { notify: async (title, body, o) => { sent.push({ title, body, ...o }); return true; } });
  const since = new Date(Date.now() - 1000).toISOString();
  store.ingest([
    { url: 'https://a.example/1', title: 'Spicers partners with Gammapaper', summary: '', publishedAt: ago(1) },
    { url: 'https://a.example/2', title: 'Gammapaper appoints new CEO', summary: '', publishedAt: ago(1) },
  ], c.id);
  assert.equal(await service.alerts.send(since), 1);
  assert.equal(sent[0].title, 'EMMA · Gammapaper'); assert.equal(sent[0].subtitle, 'Partnership or M&A');
  assert.equal(await service.alerts.send(since), 0, 'already alerted');
  service.alerts.save({ mode: 'all', keyPages: true });
  assert.equal(await service.alerts.send(since), 1);
  service.alerts.save({ mode: 'off', keyPages: false });
  assert.equal(await service.alerts.send(since), 0);
  const m = alertMessage([{ companyName: 'A', eventType: 'funding', title: 'x' }, { companyName: 'B', eventType: 'patent', title: 'y' }], STRATEGIC_EVENT_TYPES);
  assert.equal(m.title, 'EMMA · 2 strategic moves');
}));
