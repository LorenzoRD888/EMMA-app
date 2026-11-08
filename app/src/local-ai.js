// Welcome screen: bring data from a previous EMMA, choose between local AI
// and no AI, and set up the local AI (Ollama): check that Ollama is running,
// pick a model already on the computer or download one (suggested, or searched in
// the Ollama library), test it and turn it on.
// EMMA talks only to the local Ollama server, plus ollama.com for the model search.
import os from 'node:os';
import { readFileSync } from 'node:fs';
import express from 'express';
import { inspectFolder, importPrevious } from './previous-data.js';

// Models suggested on the welcome screen, chosen by the computer's memory.
// The welcome screen is closed for one version only while EMMA is still empty:
// after an update (for example a new install with the Terminal command) it opens again
// and asks whether to bring the data of an older EMMA. With companies in it, EMMA never insists.
const VERSION = (() => { try { return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version; } catch { return 'dev'; } })();
export const welcomeDismissed = (value, companies, version = VERSION) => value === version || (!!value && companies > 0);

export const MODELS = [
  { id: 'gemma4:12b', label: 'Gemma 4 12B', size: 'about 8 GB', minRam: 16, note: 'Good quality summaries and analyses.' },
  { id: 'gemma4:e4b', label: 'Gemma 4 E4B', size: 'about 3 GB', minRam: 8, note: 'Lighter, for computers with 8 GB of memory. Simpler summaries.' },
];
export const recommendedModel = ramGB => (ramGB >= 16 ? MODELS[0] : MODELS[1]);
// Ollama model names: "qwen3", "qwen3:14b", "user/model:tag".
export const validModel = m => typeof m === 'string' && m.length <= 120 && /^[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*)?(:[a-z0-9][a-z0-9._-]*)?$/i.test(m);

const ollamaBase = localUrl => { try { return new URL(localUrl).origin; } catch { return 'http://127.0.0.1:11434'; } };
const strip = s => String(s || '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();

// Results of https://ollama.com/search (HTML page: one <li x-test-model> per model).
export function parseOllamaSearch(html) {
  const out = [];
  for (const block of String(html).split(/<li\b[^>]*x-test-model/i).slice(1)) {
    const href = (block.match(/href="\/(library\/)?([a-z0-9][a-z0-9._\/-]*)"/i) || [])[2];
    const title = strip((block.match(/x-test-search-response-title[^>]*>([\s\S]*?)<\/span>/i) || [])[1]) || href;
    if (!title || !validModel(title)) continue;
    const description = strip((block.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i) || [])[1]).slice(0, 240);
    const sizes = [...block.matchAll(/x-test-size[^>]*>([\s\S]*?)<\/span>/gi)].map(m => strip(m[1]).toLowerCase()).filter(s => /^[a-z0-9.]+$/.test(s));
    const capabilities = [...block.matchAll(/x-test-capability[^>]*>([\s\S]*?)<\/span>/gi)].map(m => strip(m[1]).toLowerCase());
    const pulls = strip((block.match(/x-test-pull-count[^>]*>([\s\S]*?)<\/span>/i) || [])[1]);
    const updated = strip((block.match(/x-test-updated[^>]*>([\s\S]*?)<\/span>/i) || [])[1]);
    out.push({ name: title, description, sizes: [...new Set(sizes)], capabilities, pulls, updated });
    if (out.length >= 20) break;
  }
  return out;
}

export function localAiRoutes(settings, prefs, { fetchFn = fetch, ramGB = Math.round(os.totalmem() / 2 ** 30), db = prefs.db, dataDir, rootDir, home } = {}) {
  const router = express.Router();
  let pull = { status: 'idle' };
  const base = () => ollamaBase(settings.snapshot().localUrl);

  async function ollama() {
    try {
      const v = await fetchFn(base() + '/api/version', { signal: AbortSignal.timeout(2500) });
      if (!v.ok) return { running: false, models: [], installed: [] };
      const version = (await v.json()).version || '';
      const t = await fetchFn(base() + '/api/tags', { signal: AbortSignal.timeout(4000) });
      const list = t.ok ? ((await t.json()).models || []) : [];
      return { running: true, version, models: list.map(m => m.name), installed: list.map(m => ({ name: m.name, size: m.size || 0, params: m.details?.parameter_size || '', family: m.details?.family || '' })) };
    } catch { return { running: false, models: [], installed: [] }; }
  }
  const has = (models, id) => models.some(m => m === id || m === id + ':latest');
  const companies = () => { try { return db.prepare('SELECT COUNT(*) n FROM companies').get().n; } catch { return 0; } };

  router.get('/status', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const s = settings.snapshot(), o = await ollama(), rec = recommendedModel(ramGB);
    res.json({
      aiReady: s.aiReady, provider: s.provider, localModel: s.localModel, ollama: o, ramGB,
      models: MODELS.map(m => ({ ...m, installed: has(o.models, m.id), fits: ramGB >= m.minRam })), recommended: rec.id,
      dismissed: welcomeDismissed(prefs.pref('welcome:dismissed', false), companies()), pull, companies: companies(),
      imported: prefs.pref('welcome:imported', null), platform: process.platform,
    });
  });

  // ---- Data from a previous EMMA ----
  // Only the folder the user gives: EMMA does not search the disk by itself.
  router.get('/inspect', (req, res) => {
    res.set('Cache-Control', 'no-store');
    try { res.json(inspectFolder(String(req.query.path || ''), { dataDir, home })); }
    catch (e) { res.status(400).json({ error: e.public ? e.message : 'The folder could not be read.' }); }
  });
  router.post('/import', async (req, res) => {
    try {
      const r = await importPrevious({ db, settings, from: String(req.body?.path || ''), dataDir, rootDir });
      prefs.setPref('welcome:imported', { from: r.from, at: new Date().toISOString(), companies: r.companies, news: r.news });
      res.json(r);
    } catch (e) { res.status(400).json({ error: e.public ? e.message : 'Import failed: ' + String(e.message || '').slice(0, 200) }); }
  });

  // ---- Use EMMA without AI ----
  router.post('/no-ai', async (req, res) => {
    await settings.save({ provider: 'none' });
    prefs.setPref('welcome:dismissed', VERSION);
    res.json({ ok: true });
  });

  // ---- Search the Ollama model library ----
  router.get('/search', async (req, res) => {
    const q = String(req.query.q || '').trim().slice(0, 80);
    if (!q) return res.json({ results: [] });
    try {
      const r = await fetchFn('https://ollama.com/search?' + new URLSearchParams({ q }), { signal: AbortSignal.timeout(12000), headers: { Accept: 'text/html', 'User-Agent': 'Mozilla/5.0 EMMA local app' } });
      if (!r.ok) throw Error('answered ' + r.status);
      res.json({ results: parseOllamaSearch(await r.text()) });
    } catch { res.status(502).json({ error: 'The Ollama library cannot be reached right now. Open ollama.com/search in the browser and type the model name below.' }); }
  });

  // Download a model through Ollama, with progress.
  router.post('/pull', (req, res) => {
    const model = String(req.body?.model || '').trim();
    if (!validModel(model)) return res.status(400).json({ error: 'Invalid model name. Example: qwen3:8b' });
    if (pull.status === 'running') return res.status(409).json({ error: 'A download is already running.' });
    pull = { status: 'running', model, completed: 0, total: 0, message: 'Starting the download…', startedAt: new Date().toISOString() };
    res.status(202).json(pull);
    (async () => {
      try {
        const r = await fetchFn(base() + '/api/pull', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, stream: true }) });
        if (!r.ok || !r.body) { let t = ''; try { t = await r.text(); } catch {} throw Error((() => { try { return JSON.parse(t).error; } catch { return `Ollama answered ${r.status}`; } })()); }
        const decoder = new TextDecoder(); let buf = '';
        for await (const chunk of r.body) {
          buf += decoder.decode(chunk, { stream: true });
          let i; while ((i = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (!line) continue;
            let m; try { m = JSON.parse(line); } catch { continue; }
            if (m.error) throw Error(m.error);
            if (m.total) { pull.total = m.total; pull.completed = m.completed || 0; }
            pull.message = m.status === 'success' ? 'Downloaded' : /pulling/.test(m.status || '') ? 'Downloading the model…' : /verifying/.test(m.status || '') ? 'Checking the download…' : /writing|manifest/.test(m.status || '') ? 'Almost done…' : pull.message;
            if (m.status === 'success') pull.status = 'done';
          }
        }
        if (pull.status !== 'done') throw Error('The download stopped before the end.');
      } catch (e) {
        const msg = String(e.message || '');
        pull = { ...pull, status: 'failed', error: /ECONNREFUSED|fetch failed/i.test(msg) ? 'Ollama is not running: open the Ollama app and try again.' : /file does not exist|not found|manifest unknown/i.test(msg) ? `Ollama does not know "${model}": check the name and size on ollama.com.` : /connection reset|EOF|timeout|tls|certificate/i.test(msg) ? 'The connection was interrupted. If a VPN is on, turn it off during the download and try again.' : 'Download failed: ' + msg.slice(0, 160) };
      }
    })();
  });
  router.get('/pull', (req, res) => { res.set('Cache-Control', 'no-store'); res.json(pull); });

  // Turn on a model already on the computer and check that it answers.
  router.post('/use', async (req, res) => {
    const model = String(req.body?.model || '');
    if (!validModel(model)) return res.status(400).json({ error: 'Invalid model name.' });
    const o = await ollama();
    if (!o.running) return res.status(400).json({ error: 'Ollama is not running: open the Ollama app.' });
    const exact = o.models.find(m => m === model || m === model + ':latest');
    if (!exact) return res.status(400).json({ error: 'The model is not on this computer yet: download it first.' });
    try {
      await settings.save({ provider: 'local', localModel: exact, localUrl: base() + '/v1' });
      const t0 = Date.now();
      await settings.test();
      prefs.setPref('welcome:dismissed', VERSION);
      res.json({ ok: true, model: exact, seconds: Math.round((Date.now() - t0) / 1000) });
    } catch {
      res.status(400).json({ error: 'The model is saved but did not answer. Wait a few seconds (the first start is slow) and press the button again.' });
    }
  });

  router.post('/dismiss', (req, res) => { prefs.setPref('welcome:dismissed', req.body?.dismissed === false ? false : VERSION); res.json({ ok: true }); });
  return router;
}
