import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openMarket } from '../src/market-store.js';
import { createIntel } from '../src/intel/intel.js';
import { extractTeam, extractHistory, isPersonName } from '../src/intel/team.js';

const withStore = async fn => { const folder = await mkdtemp(path.join(os.tmpdir(), 'emma-team-')); const store = openMarket(path.join(folder, 't.sqlite')); try { await fn(store); } finally { store.close(); await rm(folder, { recursive: true, force: true }); } };
const html = body => ({ ok: true, url: '', headers: new Map([['content-type', 'text/html']]), text: async () => `<html><body>${body}</body></html>` });

test('team and history come from the official website; namesakes are flagged and can be removed', () => withStore(async store => {
  assert.equal(isPersonName('Business Development'), false);
  assert.equal(isPersonName('Jane Smith'), true);
  assert.deepEqual(extractTeam(['Jane Smith', 'Founder & CEO']).map(p => p.name), ['Jane Smith']);
  assert.match(extractHistory(['Acmecomms was founded in 2008 in Singapore by Jane Smith.']).sentences[0], /2008/);
  const c = store.saveCompany({ name: 'Acme Comms', website: 'https://www.acmecomms.com', sector: 'public relations', keywords: 'public relations' });
  const pages = { 'https://www.acmecomms.com/about': '<h2>Jane Smith</h2><p>Founder & CEO</p><p>Acme Comms was founded in 2008 in Singapore and has grown into a regional agency.</p>' };
  const fetchFn = async url => pages[url] ? html(pages[url]) : { ok: false, headers: new Map(), text: async () => '' };
  const intel = createIntel(store, { fetchFn });
  const db = store.db;
  const ins = db.prepare('INSERT INTO people(id,companyId,name,role,location,url,current,snippet,query,firstSeen,lastSeen,baseline,source) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)');
  const t = new Date().toISOString();
  ins.run('p1', c.id, 'Jane Smith', 'CEO', '', 'https://linkedin.com/in/jane', 1, 'CEO at Acme Comms', 'q', t, t, 0, '');
  ins.run('p2', c.id, 'Kevin Acme', 'Realtor', 'Florida', 'https://linkedin.com/in/ken', 1, 'Realtor in Orlando', 'q', t, t, 0, '');
  const r = await intel.scanTeam(c);
  assert.equal(r.pages, 1);
  const people = Object.fromEntries(intel.dossier(c.id).people.map(p => [p.id, p.checked]));
  assert.equal(people.p1, 'website');
  assert.equal(people.p2, 'unverified');
  assert.ok(intel.dossier(c.id).facts.some(f => f.kind === 'history' && /2008/.test(f.text)));
  intel.hidePerson('p2');
  assert.ok(!intel.dossier(c.id).people.some(p => p.id === 'p2'));
  assert.equal(intel.dossier(c.id).hiddenPeople, 1);
  // People-search pages are never accepted.
  assert.equal(intel.judge({ url: 'https://www.whitepages.com/name/Kevin-Acme', title: 'Acme Comms', summary: '' }, c, true).verdict, 'reject');
}));
