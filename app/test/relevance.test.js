import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openMarket } from '../src/market-store.js';
import { createMarketService, matchesCompany } from '../src/market-service.js';
import { isProfilePage, strongSignal, probablyOld, siteLabel, specificTerms } from '../src/intel/relevance.js';
import { buildCompanyDocx } from '../src/company-export.js';
import { researchPlan, RESEARCH_DEFAULTS } from '../src/research-plan.js';

test('relevance rules: directories, website and people proofs, old undated articles, generic words', () => {
  assert.ok(isProfilePage('https://www.linkedin.com/company/root-communications'));
  assert.ok(isProfilePage('https://www.bloomberg.com/profile/company/123Z:LN'));
  assert.ok(isProfilePage('https://rocketreach.co/root-communications-profile_b5c'));
  assert.ok(!isProfilePage('https://www.bloomberg.com/news/articles/2026-10-01/x'));
  assert.ok(!isProfilePage('https://www.linkedin.com/posts/root_abc'));
  const co = { name: 'Branch Communications', website: 'https://www.branchcomms.example' };
  assert.equal(siteLabel(co.website), 'branchcomms');
  assert.match(strongSignal({ title: 'Agency news', summary: 'Contact them at branchcomms.example for Asia PR' }, co), /website/);
  assert.match(strongSignal({ title: 'Interview', summary: 'Said Jane Smith, CEO of the agency' }, co, { people: ['Jane Smith'] }), /Jane Smith/);
  assert.equal(strongSignal({ title: 'Branch Communications plants strategy', summary: '' }, co), null);
  assert.equal(probablyOld({ title: 'Branch Communications plants solid strategy', summary: 'Orlando, 1996 and 1998' }, { now: new Date('2026-11-03') }), 1998);
  assert.equal(probablyOld({ title: 'x', summary: 'in 2025', publishedAt: null }, { now: new Date('2026-11-03') }), null);
  assert.deepEqual(specificTerms(['strategy', 'growth', 'influencer', 'singapore', 'market']), ['influencer', 'singapore']);
});

test('judge: profile pages become profiles, generic context is not enough, website mention is', async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'emma-rel-')); const store = openMarket(path.join(folder, 'm.sqlite'));
  try {
    const c = store.saveCompany({ name: 'Branch Communications', website: 'https://www.branchcomms.example' });
    const svc = createMarketService(store, { snapshot: () => ({ provider: 'none', configured: {} }) });
    svc.intel.saveIntel(c.id, { terms: ['strategy', 'growth', 'digital', 'influencer', 'singapore'] });
    const j = item => svc.intel.judge(item, store.company(c.id), matchesCompany(item, store.company(c.id))).verdict;
    assert.equal(j({ url: 'https://www.linkedin.com/company/root', title: 'Branch Communications', summary: '' }), 'profile');
    assert.equal(j({ url: 'https://news.example/a', title: 'Branch Communications plants solid strategy for growth', summary: '' }), 'review', 'generic words are not proof');
    assert.equal(j({ url: 'https://news.example/b', title: 'Branch Communications opens Singapore office', summary: '' }), 'accept');
    assert.equal(j({ url: 'https://news.example/c', title: 'Branch Communications', summary: 'Visit branchcomms.example' }), 'accept');
    assert.equal(j({ url: 'https://news.example/d', title: 'Branch Communications in Singapore', summary: 'back in 1997' }), 'review', 'probably old');
    assert.equal(svc.intel.saveProfiles(c.id, [{ url: 'https://www.linkedin.com/company/root', title: 'Branch Communications | LinkedIn', summary: 'PR agency' }]), 1);
    assert.equal(svc.intel.dossier(c.id).profiles.length, 1);
    const plan = researchPlan({ ...store.company(c.id), keywords: 'PR', keyPeople: ['Jane Smith'] }, { ...RESEARCH_DEFAULTS, mode: 'wide', includeChinese: false }, { tavily: true });
    const byLabel = Object.fromEntries(plan.tasks.map(t => [t.label, t]));
    assert.equal(byLabel['Mentions of the website'].query, '"branchcomms.example"'); assert.deepEqual(byLabel['Mentions of the website'].excludeDomains, ['branchcomms.example']);
    assert.equal(byLabel['Key person · Jane Smith'].query, '"Jane Smith" "Branch Communications"');
    assert.ok(byLabel['Clients, case studies and awards']);
    const buf = await buildCompanyDocx(svc.intel.dossier(c.id), { sectors: ['PR in Asia'], keyPages: [] });
    assert.ok(buf.length > 2000); assert.equal(buf.subarray(0, 2).toString(), 'PK');
  } finally { store.close(); await rm(folder, { recursive: true, force: true }); }
});
