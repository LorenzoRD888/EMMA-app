import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openMarket } from '../src/market-store.js';
import { createMarketService } from '../src/market-service.js';
import { createIntel } from '../src/intel/intel.js';
import { signalTasks, gapTasks, needsSecondRound, externalCount, companyLanguage } from '../src/intel/coverage.js';
import { strategicEvent, isJobPosting, jobDetails } from '../src/intel/strategic-events.js';
import { relevance, explain, validateProfile } from '../src/brief.js';
import { searchLabel } from '../src/intel/learning.js';
import { noteTerms, noteQuery, matchNote } from '../src/intel/note-watch.js';

const withStore = async fn => { const folder = await mkdtemp(path.join(os.tmpdir(), 'emma-insight-')); const store = openMarket(path.join(folder, 't.sqlite')); try { await fn(store, folder); } finally { store.close(); await rm(folder, { recursive: true, force: true }); } };
const settings = { snapshot: () => ({ provider: 'none', configured: {} }), client: () => ({ messages: { create: async () => ({ content: [{ text: '{}' }] }) } }) };
const ago = n => new Date(Date.now() - n * 86400000).toISOString();
const done = async service => { for (let i = 0; i < 200 && service.job()?.status === 'running'; i++) await new Promise(r => setTimeout(r, 10)); };

test('weak signals: job openings, distributors, local-language trade press; second round only when coverage is thin', () => {
  const c = { name: 'Acme', country: 'Italy', website: 'https://acme.example', keywords: 'films' };
  const labels = signalTasks(c).map(t => t.label);
  assert.ok(labels.includes('Signals · job openings') && labels.includes('Signals · certifications') && labels.includes('Signals · distributors and channels') && labels.includes('Signals · Italian trade press'));
  assert.deepEqual(signalTasks(c, { mode: 'daily' }), []);
  assert.equal(companyLanguage('Vietnam').code, 'vi');
  assert.equal(needsSecondRound({ externalNow: 5, externalArchive: 0 }).needed, false);
  assert.equal(needsSecondRound({ externalNow: 1, externalArchive: 20 }).needed, false);
  assert.equal(needsSecondRound({ externalNow: 1, externalArchive: 2 }).needed, true);
  assert.equal(externalCount([{ url: 'https://acme.example/a', verdict: 'accept' }, { url: 'https://news.example/b', verdict: 'accept' }, { url: 'https://news.example/c', verdict: 'review' }], c.website), 1);
  const gap = gapTasks(c, { people: ['Jane Smith', 'X'] });
  assert.ok(gap.every(t => t.label.startsWith('Second round · ') && t.recent === false));
  assert.ok(gap.some(t => t.label === 'Second round · person · Jane Smith') && gap.some(t => t.domain === 'youtube.com') && gap.some(t => /intervista/.test(t.query)));
});

test('job postings and new distributors are strategic signals', () => {
  assert.ok(isJobPosting('https://www.linkedin.com/jobs/view/123'));
  assert.ok(isJobPosting('https://de.indeed.com/viewjob?jk=abc'));
  assert.ok(!isJobPosting('https://www.linkedin.com/company/acme'));
  assert.equal(strategicEvent({ url: 'https://www.linkedin.com/jobs/view/1', title: 'Acme hiring R&D Engineer in Hanoi, Vietnam | LinkedIn', summary: '' }).eventType, 'hiring');
  const d = jobDetails({ title: 'Acme hiring R&D Engineer in Hanoi, Vietnam | LinkedIn' }, ['Acme']);
  assert.deepEqual([d.role, d.country, d.area], ['R&D Engineer', 'Vietnam', 'R&D']);
  assert.equal(strategicEvent({ url: 'https://n.example/a', title: 'Acme appoints Solartech as exclusive distributor for India', summary: '' }).eventType, 'distribution');
});

test('relevance to your company: products, customers, markets; plain explanation', () => {
  const p = validateProfile({ name: 'Me', products: [{ name: 'Alphamat', terms: '1500 V, backsheet' }], markets: 'India, photovoltaic', customers: 'Sunfield', competitors: ['c1'] });
  const why = relevance('Acme certifies a 1500V backsheet for Sunfield in India and the photovoltaics market', p, { companyId: 'c1' });
  assert.deepEqual(why.map(w => w.kind).sort(), ['competitor', 'customer', 'market', 'market', 'product']);
  assert.equal(explain(why), 'mentions your customer Sunfield; mentions “1500 V”, like your product Alphamat; concerns markets you serve: India, photovoltaic; from a direct competitor');
  assert.deepEqual(relevance('Indiana plant', p), []);
  assert.deepEqual(relevance('anything', { name: '' }), []);
});

test('changes with why they matter and "what changed": every line has a source link and date', () => withStore(async store => {
  const a = store.saveCompany({ name: 'Acme', website: 'https://acme.example', country: 'Italy', keywords: 'films' });
  const service = createMarketService(store, settings, { fetchSite: async () => new Response('', { status: 404 }) });
  store.ingest([
    { url: 'https://news.example/acme-1500v', title: 'Acme launches new 1500 V backsheet for India', summary: 'Acme launches a new 1500 V backsheet.', publishedAt: ago(2) },
    { url: 'https://www.linkedin.com/jobs/view/1', title: 'Acme hiring R&D Engineer in Hanoi, Vietnam | LinkedIn', summary: '', publishedAt: ago(1) },
    { url: 'https://www.linkedin.com/jobs/view/2', title: 'Acme hiring Process Engineer in Hanoi, Vietnam | LinkedIn', summary: '', publishedAt: ago(1) },
    { url: 'https://news.example/acme-old', title: 'Acme launches new film line', summary: '', publishedAt: ago(300) },
  ], a.id);
  let b = service.brief.build({ days: 7 });
  assert.equal(b.profileReady, false);
  assert.ok(b.top.every(x => /^https?:\/\//.test(x.url) && x.date));
  const jobs = b.top.find(x => x.kind === 'jobs');
  assert.match(jobs.title, /2 job openings: .*Vietnam/);
  assert.ok(!b.top.some(x => /acme-old/.test(x.url)), 'old articles are not in a weekly brief');
  service.brief.saveProfile({ name: 'Me', products: [{ name: 'Alphamat', terms: ['1500 V'] }], markets: ['India'], competitors: [a.id] });
  b = service.brief.build({ days: 7 });
  assert.equal(b.top[0].url, 'https://news.example/acme-1500v');
  assert.match(b.top[0].whyText, /1500 V/);
  const w = service.brief.whatChanged();
  assert.ok(w.items.length <= 5 && w.items[0].isNew);
  service.brief.markSeen();
  assert.equal(service.brief.whatChanged().newCount, 0);
  await assert.rejects(service.briefAI({ days: 7 }), /AI/);
}));

test('learning: discarded sites and similar articles are filtered, kept sites trusted, useless searches skipped, all reversible', () => withStore(async store => {
  const a = store.saveCompany({ name: 'Acme', website: 'https://acme.example', keywords: 'films' });
  const intel = createIntel(store, { fetchFn: async () => new Response('', { status: 404 }) });
  const item = (n, host = 'spam.example', title = `Acme item number ${n} about films`) => ({ url: `https://${host}/${n}`, title, summary: 'Acme films', foundVia: { label: 'Tavily · Signals · certifications' } });
  store.ingest(Array.from({ length: 6 }, (_, i) => ({ ...item(i), review: true })), a.id);
  const ids = store.db.prepare("SELECT id FROM news WHERE url LIKE 'https://spam.example/%'").all().map(r => r.id);
  for (const id of ids.slice(0, 3)) intel.resolveReview(id, false);
  assert.equal(intel.judge(item(10, 'spam.example', 'Acme opens plant for films'), a, true).verdict, 'review');
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM news WHERE deletedAt IS NOT NULL').get().n, 3, 'discarded articles stay in the bin');
  store.ingest([item(0)], a.id);
  assert.equal(store.db.prepare("SELECT deletedAt FROM news WHERE url='https://spam.example/0'").get().deletedAt !== null, true, 'a discarded address never comes back');
  for (const id of ids.slice(3)) intel.resolveReview(id, false);
  assert.equal(intel.judge(item(11, 'spam.example', 'Acme opens plant for films'), a, true).verdict, 'reject');
  assert.match(intel.judge(item(12, 'other.example', 'Acme item number 99 about films'), a, true).reason, /Similar to an article you discarded/);
  assert.match(intel.learning.skipTask(a.id, 'Signals · certifications'), /Skipped/);
  assert.equal(searchLabel('Brave Search · Signals · certifications'), 'Signals · certifications');
  // Trusted site: kept 3 times, never discarded.
  store.ingest([0, 1, 2].map(n => ({ ...item(n, 'good.example', `Good ${n} Acme story`), foundVia: { label: 'Tavily · Recent news' }, review: true })), a.id);
  for (const r of store.db.prepare("SELECT id FROM news WHERE url LIKE 'https://good.example/%'").all()) intel.resolveReview(r.id, true);
  const reviewed = { url: 'https://good.example/9', title: 'Something new', summary: 'Acme in the excerpt only' };
  assert.equal(intel.judge(reviewed, a, true).verdict, 'accept');
  const s = intel.learning.summary();
  assert.equal(s.trusted[0].domain, 'good.example'); assert.equal(s.blocked[0].domain, 'spam.example'); assert.equal(s.skipped.length, 1);
  intel.learning.forget('domain', 'spam.example');
  assert.notEqual(intel.judge(item(13, 'spam.example', 'Acme opens plant for films'), a, true).reason, 'You discarded 6 articles from spam.example');
}));

test('second round runs when an update finds little outside the website', () => withStore(async store => {
  const previous = process.env.TAVILY_API_KEY; process.env.TAVILY_API_KEY = 'test-only';
  try {
    const a = store.saveCompany({ name: 'Acme', website: 'https://acme.example', keywords: 'films', country: 'Italy' });
    const queries = [];
    const service = createMarketService(store, settings, { fetchSite: async () => new Response('', { status: 404 }), fetchPage: async () => new Response('', { status: 404 }), papers: async () => [], patents: async () => [],
      search: async (q, o) => { queries.push(o.label || q); return /Second round · interviews/.test(o.label || '') ? [{ url: 'https://podcast.example/acme', title: 'Interview with the Acme CEO on films', summary: 'Acme films' }] : []; } });
    service.saveResearch({ mode: 'daily', maxPages: 0, resultsPerQuery: 5, freeNews: false });
    service.start({ companyIds: [a.id], days: 7 }); await done(service);
    assert.ok(queries.some(q => /^Second round/.test(q)));
    assert.equal(store.stats().runs[0].detail.secondRounds.length, 1);
    assert.ok(store.query().items.some(n => n.url === 'https://podcast.example/acme'));
  } finally { if (previous === undefined) delete process.env.TAVILY_API_KEY; else process.env.TAVILY_API_KEY = previous; }
}));


test('post-its: EMMA picks the words, checks the archive, searches at each update and shows what it found', () => withStore(async store => {
  const c = { name: 'Acme', aliases: ['Acme Films'] };
  const t = noteTerms({ title: 'Fabbrica in Vietnam?', content: 'verificare se stanno costruendo una fabbrica in Vietnam per i film da 1500 V' }, c);
  assert.deepEqual(t.filter(x => x.specific).map(x => x.term), ['1500 V', 'Vietnam']);
  assert.equal(noteQuery(c, t), '"Acme" "1500 V" Vietnam');
  assert.deepEqual(matchNote({ title: 'Acme builds new factory in Vietnam', summary: '' }, t), ['Vietnam']);
  assert.equal(matchNote({ title: 'Acme results', summary: 'quarter' }, t), null);
  assert.deepEqual(noteTerms({ title: 'CEO', content: 'Hanno cambiato CEO? Mario Rossi sembra uscito' }, c).filter(x => x.specific).map(x => x.term), ['CEO', 'Mario Rossi']);

  const previous = process.env.TAVILY_API_KEY; process.env.TAVILY_API_KEY = 'test-only';
  try {
    const a = store.saveCompany({ name: 'Acme', website: 'https://acme.example', keywords: 'films' });
    store.ingest([{ url: 'https://news.example/old-vietnam', title: 'Acme looks at Vietnam for growth', summary: 'Acme films', publishedAt: ago(40) }], a.id);
    const queries = [];
    const service = createMarketService(store, settings, { fetchSite: async () => new Response('', { status: 404 }), fetchPage: async () => new Response('', { status: 404 }), papers: async () => [], patents: async () => [],
      search: async (q, o) => { queries.push(q); return /Your post-it/.test(o.label || '') ? [{ url: 'https://news.example/plant', title: 'Acme opens a films plant in Vietnam', summary: 'Acme films plant Vietnam', publishedAt: ago(1) }] : []; } });
    const note = store.entries.save(a.id, { section: 'overview', title: 'Fabbrica in Vietnam?', content: 'stanno costruendo una fabbrica in Vietnam?', type: 'note' });
    service.noteSaved(note);
    let w = service.notes.forCompany(a.id)[note.id];
    assert.equal(w.findings[0].url, 'https://news.example/old-vietnam', 'the archive is checked at once');
    service.saveResearch({ mode: 'daily', maxPages: 0, resultsPerQuery: 5, freeNews: false, secondRound: false });
    service.start({ companyIds: [a.id], days: 7 }); await done(service);
    assert.ok(queries.includes('"Acme" Vietnam'));
    w = service.notes.forCompany(a.id)[note.id];
    assert.equal(w.total, 2); assert.ok(w.lastCheckedAt);
    assert.ok(service.brief.whatChanged().items.some(x => x.url === 'https://news.example/plant' && (x.kind === 'note' || x.notes?.includes('Fabbrica in Vietnam?'))));
    service.notes.setWatch(note.id, false);
    assert.deepEqual(service.notes.tasks(a), []);
  } finally { if (previous === undefined) delete process.env.TAVILY_API_KEY; else process.env.TAVILY_API_KEY = previous; }
}));

test('"Update company" includes the media search (interviews, TV, videos, posts); the daily update of all companies does not', async () => {
  const { researchPlan } = await import('../src/research-plan.js');
  const c = { name: 'Acme', website: 'https://acme.example', keywords: 'films' };
  const labels = o => researchPlan(c, { mode: 'daily', ...o }, { tavily: true }).tasks.map(t => t.label);
  assert.ok(labels({ media: true }).includes('Media · interviews and podcasts'));
  assert.ok(!labels({}).includes('Media · interviews and podcasts'));
});

test('missing dates are found without clicking: the page first, then the first Internet Archive copy (marked approximate)', () => withStore(async store => {
  const a = store.saveCompany({ name: 'Acme', website: 'https://acme.example' });
  store.ingest([{ url: 'https://news.example/no-date', title: 'Acme story', summary: 'Acme' }], a.id);
  const service = createMarketService(store, settings, { fetchSite: async () => new Response('', { status: 404 }),
    fetchPage: async url => /archive\.org/.test(url) ? new Response(JSON.stringify({ archived_snapshots: { closest: { timestamp: '20190412083000' } } }), { headers: { 'Content-Type': 'application/json' } }) : new Response('<html><p>No date here, only text about Acme.</p></html>', { headers: { 'Content-Type': 'text/html' } }) });
  const r = await service.backfillDates(a.id, 10);
  assert.equal(r.found, 1);
  const n = store.db.prepare("SELECT publishedAt,dateHow FROM news WHERE url='https://news.example/no-date'").get();
  assert.equal(n.publishedAt, '2019-04-12T08:30:00Z'); assert.match(n.dateHow, /Approximate/);
}));
