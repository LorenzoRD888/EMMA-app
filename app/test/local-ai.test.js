import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { localAiRoutes, recommendedModel } from '../src/local-ai.js';

const json = (o, ok = true) => ({ ok, status: ok ? 200 : 500, json: async () => o });
function fakeOllama() {
  const st = { running: false, models: [] };
  const fetchFn = async (url, opts = {}) => {
    if (!st.running) throw Error('fetch failed');
    if (url.endsWith('/api/version')) return json({ version: '0.9.0' });
    if (url.endsWith('/api/tags')) return json({ models: st.models.map(name => ({ name })) });
    if (url.endsWith('/api/pull')) {
      const model = JSON.parse(opts.body).model;
      const lines = [{ status: 'pulling manifest' }, { status: 'pulling abc', total: 100, completed: 50 }, { status: 'pulling abc', total: 100, completed: 100 }, { status: 'success' }];
      st.models.push(model);
      return { ok: true, status: 200, body: (async function* () { for (const l of lines) yield new TextEncoder().encode(JSON.stringify(l) + '\n'); })() };
    }
    throw Error('unexpected ' + url);
  };
  return { st, fetchFn };
}

test('welcome screen: Ollama check, model download with progress, turn on and test', async () => {
  assert.equal(recommendedModel(8).id, 'gemma4:e4b');
  assert.equal(recommendedModel(32).id, 'gemma4:12b');
  const { st, fetchFn } = fakeOllama();
  let saved = { provider: 'anthropic', localUrl: 'http://127.0.0.1:11434/v1', localModel: '', aiReady: false };
  const settings = { snapshot: () => saved, save: async b => { saved = { ...saved, ...b, aiReady: true }; return saved; }, test: async () => true };
  const prefs = new Map(); const store = { pref: (k, f) => prefs.has(k) ? prefs.get(k) : f, setPref: (k, v) => prefs.set(k, v) };
  const app = express(); app.use(express.json()); app.use('/api/setup', localAiRoutes(settings, store, { fetchFn, ramGB: 16 }));
  const server = app.listen(0); const base = `http://127.0.0.1:${server.address().port}/api/setup`;
  const call = async (p, body) => { const r = await fetch(base + p, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}); return { http: r.status, ...(await r.json()) }; };
  try {
    let s = await call('/status');
    assert.equal(s.ollama.running, false); assert.equal(s.aiReady, false); assert.equal(s.recommended, 'gemma4:12b'); assert.equal(s.dismissed, false);
    st.running = true;
    s = await call('/status'); assert.equal(s.ollama.running, true); assert.equal(s.models[0].installed, false);
    assert.equal((await call('/pull', { model: 'evil; rm' })).http, 400);
    assert.equal((await call('/use', { model: 'gemma4:12b' })).http, 400);
    assert.equal((await call('/pull', { model: 'gemma4:12b' })).http, 202);
    let p; for (let i = 0; i < 50; i++) { p = await call('/pull'); if (p.status !== 'running') break; await new Promise(r => setTimeout(r, 10)); }
    assert.equal(p.status, 'done'); assert.equal(p.total, 100);
    s = await call('/status'); assert.equal(s.models[0].installed, true);
    const u = await call('/use', { model: 'gemma4:12b' });
    assert.equal(u.ok, true); assert.equal(saved.provider, 'local'); assert.equal(saved.localModel, 'gemma4:12b');
    assert.equal((await call('/status')).dismissed, true);
  } finally { server.close(); }
});

test('the welcome screen comes back after an update while EMMA is still empty', async () => {
  const { welcomeDismissed } = await import('../src/local-ai.js');
  assert.equal(welcomeDismissed(false, 0, '3.18.2'), false);
  assert.equal(welcomeDismissed('3.18.2', 0, '3.18.2'), true);   // closed in this version
  assert.equal(welcomeDismissed('3.18.1', 0, '3.18.2'), false);  // closed in an older version, still empty
  assert.equal(welcomeDismissed(true, 0, '3.18.2'), false);      // older EMMA saved true
  assert.equal(welcomeDismissed(true, 4, '3.18.2'), true);       // EMMA in use: do not insist
  assert.equal(welcomeDismissed('3.18.1', 4, '3.18.2'), true);
});
