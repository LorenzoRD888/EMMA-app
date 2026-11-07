import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { strategicEvent, sameEvent } from '../src/intel/strategic-events.js';
import { openMarket } from '../src/market-store.js';
import { createIntel } from '../src/intel/intel.js';

test('strategic event classification separates evidence and event date', () => {
  const primary = strategicEvent({
    url: 'https://www.alphafilm.example/news/new-production-line',
    title: 'Alphafilm opens a new production line',
    summary: 'The investment starts on 2026-09-15.'
  }, { officialWebsite: 'https://www.alphafilm.example' });
  assert.deepEqual(primary, {
    eventType: 'capacity_investment', eventDate: '2026-09-15T12:00:00.000Z', eventDateKind: 'date stated in the page', evidence: 'primary', confidence: 'high'
  });

  const secondary = strategicEvent({ url: 'https://trade.example/alphafilm', title: 'Alphafilm announces a partnership', summary: '' }, { officialWebsite: 'https://www.alphafilm.example' });
  assert.equal(secondary.eventType, 'partnership');
  assert.equal(secondary.evidence, 'secondary');
  assert.equal(secondary.confidence, 'medium');
  assert.equal(strategicEvent({ url: 'https://example.com', title: 'Alphafilm at a trade fair', summary: '' }).eventType, '');
});

test('strategic fields and monitoring priorities are kept in the local archive', async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'emma-strategic-'));
  const store = openMarket(path.join(folder, 'market.sqlite'));
  try {
    const company = store.saveCompany({ name: 'Alphafilm', website: 'https://www.alphafilm.example', watchEvents: ['capacity_investment', 'partnership'] });
    assert.deepEqual(store.company(company.id).watchEvents, ['capacity_investment', 'partnership']);
    store.ingest([{ url: 'https://www.alphafilm.example/news/new-line', title: 'Alphafilm opens a new production line', summary: 'The line opens 15/09/2026.', publishedAt: '2026-09-16' }], company.id);
    const item = store.query({ companies: company.id }).items[0];
    assert.equal(item.eventType, 'capacity_investment');
    assert.equal(item.eventDate, '2026-09-15T12:00:00.000Z');
    assert.equal(item.evidence, 'primary');
    assert.equal(item.confidence, 'high');
  } finally {
    store.close();
    await rm(folder, { recursive: true, force: true });
  }
});

test('signal center puts company monitoring priorities first', async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'emma-signals-'));
  const store = openMarket(path.join(folder, 'market.sqlite'));
  try {
    const company = store.saveCompany({ name: 'Alphafilm', website: 'https://www.alphafilm.example', watchEvents: ['partnership'] });
    store.ingest([
      { url: 'https://www.alphafilm.example/news/line', title: 'Alphafilm opens a new production line', summary: '', publishedAt: new Date(Date.now() - 2 * 86400000).toISOString() },
      { url: 'https://www.alphafilm.example/news/partner', title: 'Alphafilm announces a partnership', summary: '', publishedAt: new Date(Date.now() - 3 * 86400000).toISOString() }
    ], company.id);
    const signals = createIntel(store).signals({ days: 30 });
    assert.equal(signals.items.length, 2);
    assert.equal(signals.items[0].eventType, 'partnership');
    assert.equal(signals.items[0].priority, true);
    assert.equal(signals.priorityCount, 1);
    const comparison = createIntel(store).compare([company.id], 90);
    assert.equal(comparison.days, 90);
    assert.equal(comparison.columns[0].strategic.partnership, 1);
  } finally {
    store.close();
    await rm(folder, { recursive: true, force: true });
  }
});

test('classifier: title-first, specific rules first, company pages are never events', () => {
  const site = { officialWebsite: 'https://gammapaper.example' };
  const t = (title, url = 'https://news.example/a', summary = '') => strategicEvent({ title, url, summary }, site);
  assert.equal(t('Fedrigoni invests in Gammapaper to lead the plastic-to-fiber transition').eventType, 'partnership');
  assert.equal(t('Square Capital supports Gammapaper Series A funding').eventType, 'funding');
  assert.equal(t('Alphafilm Group Opens Alphafilm America Inc.').eventType, 'market_expansion');
  assert.equal(t('Alphafilm first European PV components supplier to open Chinese factory').eventType, 'capacity_investment');
  assert.equal(t('Alphafilm potenzia lo stabilimento di Verona').eventType, 'capacity_investment');
  for (const title of ['Questions about PFAS and paper packaging | Gammapaper', '2024 Annual Report', 'alPhAfIlM hIstory', 'Alphafilm timeline by IDTechEx', 'Our Commitment to Sustainability', 'Gammapaper Valuation & Funding History'])
    assert.equal(t(title).eventType, '', title);
  assert.equal(t('Gammapaper coatings', 'https://gammapaper.example/products/coating').eventType, '');
  const low = t('Gammapaper newsletter', 'https://news.example/b', 'Gammapaper announces a partnership with a new distributor.');
  assert.equal(low.eventType, 'partnership'); assert.equal(low.confidence, 'low');
});

test('third-party results that name the company only in the excerpt go to review', async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'emma-relevance-'));
  const store = openMarket(path.join(folder, 'market.sqlite'));
  try {
    const company = store.saveCompany({ name: 'Gammapaper', website: 'https://gammapaper.example', keywords: 'paper packaging coating' });
    const intel = createIntel(store);
    assert.deepEqual(intel.judge({ url: 'https://biolisty.example/pla', title: 'TotalEnergies Corbion Luminy PLA bioplastic', summary: 'Gammapaper makes barrier coatings for paper packaging.' }, company, true), { verdict: 'review', reason: 'Company named only in the excerpt' });
    assert.equal(intel.judge({ url: 'https://news.example/gammapaper', title: 'Gammapaper expands paper barrier coating offer', summary: 'Packaging materials.' }, company, true).verdict, 'accept');
  } finally {
    store.close();
    await rm(folder, { recursive: true, force: true });
  }
});

test('signal center: dated in period, no low confidence, hidden respected, same event grouped', async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'emma-signals2-'));
  const store = openMarket(path.join(folder, 'market.sqlite'));
  try {
    const p = store.saveCompany({ name: 'Gammapaper', website: 'https://gammapaper.example' });
    const ago = d => new Date(Date.now() - d * 86400000).toISOString();
    store.ingest([
      { url: 'https://a.example/1', title: 'Fedrigoni invests in Gammapaper to lead the plastic-to-fiber transition', summary: '', publishedAt: ago(3) },
      { url: 'https://b.example/2', title: 'Fedrigoni acquires minority stake in Gammapaper', summary: '', publishedAt: ago(4) },
      { url: 'https://c.example/3', title: 'Spicers partners with Gammapaper', summary: '', publishedAt: ago(5) },
      { url: 'https://d.example/old', title: 'Gammapaper opens new plant', summary: '', publishedAt: '2019-01-01' },
      { url: 'https://e.example/nodate', title: 'Gammapaper opens new factory', summary: '' },
      { url: 'https://f.example/low', title: 'Gammapaper newsletter', summary: 'Gammapaper announces a partnership with X.', publishedAt: ago(2) },
    ], p.id);
    const intel = createIntel(store);
    let s = intel.signals({ days: 30 });
    assert.equal(s.items.length, 2); assert.ok(s.items.some(i => /^Fedrigoni/.test(i.title))); assert.ok(s.items.some(i => /^Spicers/.test(i.title)));
    assert.equal(s.items.find(i => /^Fedrigoni/.test(i.title)).title, 'Fedrigoni acquires minority stake in Gammapaper', 'earliest report shown first');
    const fed = s.items.find(i => /Fedrigoni/.test(i.title));
    assert.equal(fed.sources, 2); assert.equal(fed.status, 'confirmed'); assert.equal(fed.others.length, 1);
    const sp = s.items.find(i => /Spicers/.test(i.title));
    assert.equal(sp.status, 'to verify');
    intel.hideFromDaily('news', sp.id);
    s = intel.signals({ days: 30 });
    assert.equal(s.items.length, 1);
  } finally {
    store.close();
    await rm(folder, { recursive: true, force: true });
  }
});
