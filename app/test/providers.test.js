import { test } from 'node:test';
import assert from 'node:assert/strict';
import { webSearch, activeProvider, searchReady } from '../src/search/providers.js';
import { createAudit, withAudit } from '../src/services/research-audit.js';

const KEYS = ['TAVILY_API_KEY', 'EXA_API_KEY', 'JINA_API_KEY', 'YOU_API_KEY', 'BRAVE_API_KEY', 'SERPAPI_API_KEY', 'EMMA_SEARCH_PROVIDER', 'EMMA_SEARCH_FALLBACK'];
const withEnv = async (env, fn) => { const old = Object.fromEntries(KEYS.map(k => [k, process.env[k]])); for (const k of KEYS) delete process.env[k]; Object.assign(process.env, env); try { await fn(); } finally { for (const k of KEYS) { if (old[k] === undefined) delete process.env[k]; else process.env[k] = old[k]; } } };
const json = body => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });

test('every provider returns the same normalized shape', async () => {
  const responses = {
    tavily: [/api\.tavily\.com/, { results: [{ url: 'https://a.example/1', title: 'T', content: 'tavily text', published_date: '2026-10-01' }] }],
    exa: [/api\.exa\.ai/, { results: [{ url: 'https://a.example/2', title: 'E', text: 'exa text', publishedDate: '2026-10-02T00:00:00Z' }] }],
    jina: [/s\.jina\.ai/, { code: 200, data: [{ url: 'https://a.example/3', title: 'J', description: 'jina text', date: '2026-10-03' }] }],
    you: [/ydc-index\.io/, { results: { web: [{ url: 'https://a.example/4', title: 'Y', description: 'you', snippets: ['text'], page_age: '2026-10-04T10:00:00' }], news: [] } }],
    brave: [/api\.search\.brave\.com/, { web: { results: [{ url: 'https://a.example/5', title: 'B', description: '<strong>brave</strong> text', page_age: '2026-10-05T00:00:00' }] } }],
    serpapi: [/serpapi\.com/, { organic_results: [{ link: 'https://a.example/6', title: 'S', snippet: 'serp text' }] }],
  };
  for (const [p, [re, body]] of Object.entries(responses)) {
    const env = { [{ tavily: 'TAVILY_API_KEY', exa: 'EXA_API_KEY', jina: 'JINA_API_KEY', you: 'YOU_API_KEY', brave: 'BRAVE_API_KEY', serpapi: 'SERPAPI_API_KEY' }[p]]: 'k' };
    await withEnv(env, async () => {
      assert.equal(activeProvider(), p);
      let called = '';
      const r = await webSearch('Alphafilm', { domain: 'alphafilm.example', recent: true }, { fetchFn: async (url, init) => { called = url + ' ' + (init.body || ''); return json(body); } });
      assert.match(called, re); assert.match(called, /alphafilm\.example/);
      assert.equal(r.length, 1); assert.ok(r[0].url.startsWith('https://')); assert.ok(r[0].summary.includes('text')); assert.equal(r[0].provider, p);
      assert.doesNotMatch(r[0].summary, /<strong>/);
    });
  }
});

test('preferred provider, fallback on quota error, and clear error with no service', async () => {
  await withEnv({ TAVILY_API_KEY: 't', EXA_API_KEY: 'e', EMMA_SEARCH_PROVIDER: 'exa', EMMA_SEARCH_FALLBACK: '1' }, async () => {
    assert.equal(activeProvider(), 'exa');
    const r = await webSearch('x', {}, { fetchFn: async url => /exa/.test(url) ? new Response('', { status: 429 }) : json({ results: [{ url: 'https://b.example', title: 'ok', content: 'c' }] }) });
    assert.equal(r[0].provider, 'tavily');
  });
  await withEnv({ EXA_API_KEY: 'e', EMMA_SEARCH_FALLBACK: '0' }, async () => {
    await assert.rejects(webSearch('x', {}, { fetchFn: async () => new Response('', { status: 401 }) }), /invalid/);
  });
  await withEnv({}, async () => { assert.equal(searchReady(), false); await assert.rejects(webSearch('x'), /Set up a web search/); });
});

test('search test with noFallback reports the chosen service error, fallback otherwise', async () => {
  await withEnv({ TAVILY_API_KEY: 'k', EXA_API_KEY: 'k', EMMA_SEARCH_FALLBACK: '1' }, async () => {
    const fetchFn = async url => /tavily/.test(url) ? new Response('', { status: 401 }) : json({ results: [{ url: 'https://a.example/x', title: 'X', text: 'exa' }] });
    await assert.rejects(webSearch('q', { provider: 'tavily', noFallback: true }, { fetchFn }), /Tavily: invalid/);
    const r = await webSearch('q', { provider: 'tavily' }, { fetchFn });
    assert.equal(r[0].provider, 'exa');
  });
  await withEnv({ TAVILY_API_KEY: 'k', EXA_API_KEY: 'k', EMMA_SEARCH_FALLBACK: '1' }, async () => {
    const fetchFn = async url => new Response('', { status: /tavily/.test(url) ? 429 : 500 });
    await assert.rejects(webSearch('q', {}, { fetchFn }), /Tavily: search limit/);
  });
});

test('dossier source log records every provider search with the service name', async () => {
  await withEnv({ EXA_API_KEY: 'k' }, async () => {
    const audit = createAudit();
    await withAudit(audit, () => webSearch('Alphafilm films', {}, { fetchFn: async () => json({ results: [{ url: 'https://a.example/x', title: 'X', text: 'exa' }] }) }));
    assert.equal(audit.entries.length, 1); assert.equal(audit.entries[0].engine, 'Exa'); assert.equal(audit.entries[0].query, 'Alphafilm films'); assert.equal(audit.entries[0].results[0].url, 'https://a.example/x');
  });
});
