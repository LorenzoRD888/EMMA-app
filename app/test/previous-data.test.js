import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openMarket } from '../src/market-store.js';
import { inspectFolder, importPrevious, emmaFolder } from '../src/previous-data.js';
import { pathToFileURL } from 'node:url';
import { parseOllamaSearch, validModel } from '../src/local-ai.js';

test('data of a previous EMMA are found and imported; the old folder is not changed', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'emma-home-'));
  try {
    const oldDir = path.join(home, 'Desktop', 'EMMA old'); fs.mkdirSync(path.join(oldDir, 'data'), { recursive: true });
    fs.writeFileSync(path.join(oldDir, 'package.json'), '{"version":"3.1.0"}');
    fs.writeFileSync(path.join(oldDir, '.env'), 'TAVILY_API_KEY=tvly-old\n');
    fs.writeFileSync(path.join(oldDir, 'data', 'settings.json'), JSON.stringify({ provider: 'none', searchProvider: 'tavily' }));
    const old = openMarket(path.join(oldDir, 'data', 'market.sqlite'));
    const c = old.saveCompany({ name: 'Acme Films', website: 'https://www.acme.example' });
    old.ingest([{ url: 'https://news.example/a', title: 'Acme Films opens a plant', summary: 'Acme Films plant' }], c.id);
    old.close();
    const before = fs.statSync(path.join(oldDir, 'data', 'market.sqlite')).mtimeMs;

    const newDir = path.join(home, 'EMMA-new'); fs.mkdirSync(path.join(newDir, 'data'), { recursive: true });
    const store = openMarket(path.join(newDir, 'data', 'market.sqlite'));
    let saved = {};
    const settings = { save: async b => { saved = { ...saved, ...b }; } };
    try {
      const f = inspectFolder(`"${oldDir}/"`, { dataDir: path.join(newDir, 'data'), home });
      assert.equal(f.companies, 1); assert.equal(f.version, '3.1.0'); assert.equal(f.path, oldDir);
      assert.equal(inspectFolder(pathToFileURL(oldDir).href, { dataDir: path.join(newDir, 'data'), home }).path, oldDir);
      assert.equal(emmaFolder('~/Desktop/EMMA old', home), oldDir);
      assert.throws(() => inspectFolder(path.join(home, 'nowhere'), { dataDir: path.join(newDir, 'data'), home }), /not found/);
      assert.throws(() => inspectFolder(home, { dataDir: path.join(newDir, 'data'), home }), /No EMMA data/);
      assert.throws(() => inspectFolder(newDir, { dataDir: path.join(newDir, 'data'), home }), /this EMMA/);
      assert.equal(emmaFolder(path.join(oldDir, 'data', 'market.sqlite')), oldDir);
      const r = await importPrevious({ db: store.db, settings, from: oldDir, dataDir: path.join(newDir, 'data'), home });
      assert.equal(r.companies, 1); assert.equal(r.news, 1);
      assert.ok(fs.existsSync(r.backup));
      assert.equal(store.companies()[0].name, 'Acme Films');
      assert.equal(store.query({ q: 'plant' }).items.length, 1, 'search index rebuilt');
      assert.equal(saved.searchProvider, 'tavily'); assert.equal(saved.TAVILY_API_KEY, 'tvly-old');
      await assert.rejects(importPrevious({ db: store.db, settings, from: newDir, dataDir: path.join(newDir, 'data'), home }));
    } finally { store.close(); }
    assert.equal(fs.statSync(path.join(oldDir, 'data', 'market.sqlite')).mtimeMs, before);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('Ollama library search page is read; model names are validated', () => {
  const html = `<ul><li x-test-model class="flex"><a href="/library/qwen3"><span x-test-search-response-title>qwen3</span><p class="max-w-lg">Qwen3 is the latest generation of models.</p><span x-test-capability>tools</span><span x-test-size>0.6b</span><span x-test-size>8b</span><span x-test-size>14b</span><span x-test-pull-count>9.1M</span><span x-test-updated>2 months ago</span></a></li><li x-test-model><a href="/library/mistral"><span x-test-search-response-title>mistral</span><p>Mistral 7B.</p><span x-test-size>7b</span></a></li></ul>`;
  const r = parseOllamaSearch(html);
  assert.equal(r.length, 2);
  assert.deepEqual(r[0].sizes, ['0.6b', '8b', '14b']); assert.equal(r[0].pulls, '9.1M'); assert.deepEqual(r[0].capabilities, ['tools']);
  assert.ok(validModel('qwen3:8b')); assert.ok(validModel('user/model:latest')); assert.ok(!validModel('rm -rf')); assert.ok(!validModel('a;b'));
});
