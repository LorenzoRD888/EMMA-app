import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openMarket } from '../src/market-store.js';
import { checkLink, createLinkSafety, registrable } from '../src/intel/link-safety.js';

test('local link checks: look-alikes, disguised links, downloads, risky endings', () => {
  const companies = [{ name: 'Acme', domain: 'https://www.acmefilms.com' }];
  const level = u => checkLink(u, { companies }).level;
  assert.equal(level('https://www.reuters.com/x'), 'trusted');
  assert.equal(level('https://news.example/x'), 'ok');
  assert.equal(level('https://linkedln.com/in/x'), 'danger');
  assert.equal(level('https://www.linkedin.com.verify-account.xyz/login'), 'danger');
  assert.equal(level('https://my-paypal-support.com'), 'danger');
  assert.equal(level('https://acmefilm.com/news'), 'danger', 'one letter away from a followed company');
  assert.equal(level('https://acmefilms.com/news'), 'ok');
  assert.equal(level('https://files.example/setup.exe'), 'danger');
  assert.equal(level('https://files.example/a.zip'), 'warn');
  assert.equal(level('https://bit.ly/x'), 'warn');
  assert.equal(level('http://news.example/x'), 'warn');
  assert.equal(level('https://x.top/a'), 'warn');
  assert.equal(level('https://user@news.example/x'), 'danger');
  assert.equal(level('javascript:alert(1)'), 'danger');
  assert.equal(level('https://www.google.com/url?url=https://evil.example/x'), 'warn');
  assert.equal(checkLink('https://news.example/x', { trusted: new Set(['news.example']) }).level, 'trusted');
  assert.equal(registrable('a.b.example.co.uk'), 'example.co.uk');
});

test('Google Safe Browsing is used only with a key, and its answers are cached', async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'emma-links-')); const store = openMarket(path.join(folder, 't.sqlite'));
  const previous = process.env.SAFE_BROWSING_API_KEY;
  try {
    let calls = 0;
    const fetchFn = async (url, opts) => { calls++; const entries = JSON.parse(opts.body).threatInfo.threatEntries; return { ok: true, json: async () => ({ matches: entries.filter(e => /bad/.test(e.url)).map(e => ({ threatType: 'SOCIAL_ENGINEERING', threat: { url: e.url } })) }) }; };
    const links = createLinkSafety(store.db, store, { fetchFn });
    delete process.env.SAFE_BROWSING_API_KEY;
    let r = await links.check(['https://bad.example/x', 'https://good.example/y']);
    assert.equal(calls, 0); assert.equal(r.google.used, false); assert.equal(r.results['https://bad.example/x'].level, 'ok');
    process.env.SAFE_BROWSING_API_KEY = 'test';
    r = await links.check(['https://bad.example/x', 'https://good.example/y']);
    assert.equal(calls, 1);
    assert.equal(r.results['https://bad.example/x'].level, 'danger'); assert.match(r.results['https://bad.example/x'].reasons[0], /phishing/);
    assert.equal(r.results['https://good.example/y'].google, true);
    await links.check(['https://bad.example/x', 'https://good.example/y']);
    assert.equal(calls, 1, 'cached');
  } finally { if (previous === undefined) delete process.env.SAFE_BROWSING_API_KEY; else process.env.SAFE_BROWSING_API_KEY = previous; store.close(); await rm(folder, { recursive: true, force: true }); }
});
