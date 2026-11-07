import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openMarket } from '../src/market-store.js';
import { createMarketService } from '../src/market-service.js';
import { matchSector } from '../src/intel/sectors.js';

const settings = { snapshot: () => ({ provider: 'none', configured: {} }), client: () => { throw Error('no AI'); } };
const ago = d => new Date(Date.now() - d * 86400000).toISOString();
const sector = { terms: ['backsheet', 'PET film', 'fluorine-free', 'photovoltaic'], applications: ['PV module'], exclude: ['music'] };

test('sector rules: a word in the title, or two in the text; excluded words win', () => {
  assert.ok(matchSector(sector, { title: 'Alphafilm launches new fluorine-free backsheets' }));
  assert.equal(matchSector(sector, { title: 'Alphafilm results 2025', text: 'The group grew in photovoltaic markets.' }), null, 'one word in the text is not enough');
  assert.equal(matchSector(sector, { title: 'Alphafilm results 2025', text: 'Growth in photovoltaic backsheet demand.' }).basis, 'text');
  assert.equal(matchSector(sector, { title: 'Backsheet music festival' }), null);
  assert.ok(matchSector(sector, { title: 'Products', url: 'https://alphafilm.example/en/pv-module-backsheet/' }), 'address counts as title');
  assert.ok(matchSector(sector, { title: 'New PET-film line' }), 'hyphen or space');
});

test('sectors label the archive, filter the Daily and compare only sector evidence', async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'emma-sectors-'));
  const store = openMarket(path.join(folder, 'm.sqlite'));
  try {
    const c = store.saveCompany({ name: 'Alphafilm', website: 'https://www.alphafilm.example' });
    const t = store.saveCompany({ name: 'Omegafilm', website: 'https://www.omegafilm.example' });
    const x = store.saveCompany({ name: 'Other', website: 'https://other.example' });
    store.ingest([
      { url: 'https://www.alphafilm.example/news/alphamat', title: 'Alphafilm launches a new fluorine-free backsheet', summary: '', publishedAt: ago(3) },
      { url: 'https://news.example/alphafilm-insulation', title: 'Alphafilm opens a new insulation film line', summary: 'Electrical insulation for motors.', publishedAt: ago(4) },
    ], c.id);
    store.ingest([{ url: 'https://news.example/omegafilm-pv', title: 'Omegafilm invests 50 million in PET film plant for photovoltaic backsheets', summary: '', publishedAt: ago(5) }], t.id);
    store.ingest([{ url: 'https://news.example/other', title: 'Other launches a new backsheet', summary: '', publishedAt: ago(2) }], x.id);
    const service = createMarketService(store, settings, { fetchSite: async () => new Response('', { status: 404 }) });
    const s = service.sectors.save({ name: 'Photovoltaic backsheets', question: 'How are we moving?', terms: 'backsheet, PET film, fluorine-free', applications: 'PV module', exclude: '', companyIds: [c.id, t.id], watch: ['capacity_investment'] });
    const e = service.sectors.evidence(s.id);
    assert.deepEqual(e.columns.map(col => col.company.name), ['Alphafilm', 'Omegafilm']);
    const cov = e.columns[0], tor = e.columns[1];
    assert.equal(cov.areas.offer.count, 1); assert.equal(cov.areas.offer.primary, 1); assert.equal(cov.areas.production.count, 0, 'insulation line is not in the sector');
    assert.equal(tor.areas.production.count, 1);
    assert.match(e.summary[0].text, /In Photovoltaic backsheets, EMMA found for Alphafilm 1 offer source; no public evidence collected for .*production/);
    const feed = service.intel.feed({ days: 30, sector: s.id });
    assert.deepEqual(feed.items.map(i => i.title).sort(), ['Alphafilm launches a new fluorine-free backsheet', 'Omegafilm invests 50 million in PET film plant for photovoltaic backsheets']);
    assert.equal(feed.items[0].sectors[0].name, 'Photovoltaic backsheets');
    assert.equal(service.intel.feed({ days: 30 }).items.length, 4, 'the general Daily is unchanged');
    const sig = service.intel.signals({ days: 30, sector: s.id });
    assert.equal(sig.items.find(i => i.companyName === 'Omegafilm').priority, true, 'sector watch marks priority');
    assert.equal(service.sectors.evidence(s.id, { companies: x.id }).columns[0].inSector, false);
    assert.throws(() => service.sectors.save({ name: 'photovoltaic BACKSHEETS', terms: 'film' }), /already exists/);
    assert.throws(() => service.sectors.save({ name: 'Empty' }), /at least one word/);
    assert.equal(service.sectors.remove(s.id), 1);
    assert.equal(service.intel.feed({ days: 30 }).items[0].sectors.length, 0);
  } finally { store.close(); await rm(folder, { recursive: true, force: true }); }
});
