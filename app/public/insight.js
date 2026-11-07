// "So what" screens: the changes of a company with why they matter (Overview),
// your company's profile (Settings), the "What changed" box of the Daily,
// the post-its EMMA follows and what EMMA learned from you.
// Every line shown has its source link and date; lines without a source are never shown.
const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
async function api(url, options = {}) {
  const r = await fetch('/api' + url, { ...options, headers: { 'Content-Type': 'application/json' }, body: options.body ? JSON.stringify(options.body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Error(j.error || (r.status === 404 ? 'This function needs the new version: close EMMA and start it again.' : `Operation failed (${r.status}).`));
  return j;
}
const day = v => { const t = Date.parse(v || ''); return Number.isFinite(t) ? new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'date n/a'; };
const link = (url, text) => `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(text)} ↗</a>`;
const rerender = () => window.emmaRender?.();
const toast = (m, e) => window.emmaToast?.(m, e);

// ---------- Brief ----------
function whyLine(x) {
  if (x.aiText) return `<p class="b-why"><b>Why it matters:</b> ${esc(x.aiText)} <span class="pill tiny-pill" title="Sentence written by the AI from this source only">AI</span></p>`;
  if (x.whyText) return `<p class="b-why"><b>Why it matters:</b> ${esc(x.whyText)}.</p>`;
  return x.whyGeneric ? `<p class="b-why muted">${esc(x.whyGeneric)}</p>` : '';
}
const noteLine = x => x.notes?.length ? `<p class="b-why b-note">❖ Answers your post-it ${x.notes.map(n => '“' + esc(n) + '”').join(', ')}</p>` : '';
function itemCard(x, { company = true } = {}) {
  const extra = x.kind === 'jobs' && x.jobs?.length ? `<details class="b-more"><summary>${x.jobs.length} job posting${x.jobs.length > 1 ? 's' : ''}</summary>${x.jobs.map(j => `<p class="small">${link(j.url, j.role + (j.place ? ' · ' + j.place : ''))} <span class="muted">${esc(j.source)} · ${day(j.date)}</span></p>`).join('')}</details>`
    : x.others?.length ? `<details class="b-more"><summary>${x.others.length} more source${x.others.length > 1 ? 's' : ''}</summary>${x.others.map(o => `<p class="small">${link(o.url, o.title)} <span class="muted">${esc(o.source)} · ${day(o.date)}</span></p>`).join('')}</details>`
    : x.change ? `<p class="small muted">${x.change.addedCount ? 'Added: ' + x.change.added.slice(0, 3).map(esc).join(' · ') : ''}${x.change.removedCount ? ' Removed: ' + x.change.removed.slice(0, 3).map(esc).join(' · ') : ''}</p>` : '';
  const tags = x.why.filter(w => w.kind !== 'competitor').map(w => `<span class="pill b-tag b-${w.kind}">${esc(w.kind === 'customer' ? 'Your customer' : w.kind === 'product' ? 'Your product' : 'Your market')}: ${esc(w.term)}</span>`).join('');
  return `<article class="b-item"><div class="b-icon b-k-${esc(x.kind)}" title="${esc(x.label)}">${esc(x.icon)}</div><div class="b-body">
    <div class="b-meta">${company ? `<b>${esc(x.companyName)}</b> · ` : ''}${esc(x.label)} · ${day(x.date)}${x.confirmed ? ' · <span class="ok-text">confirmed</span>' : ''}</div>
    <h4>${link(x.url, x.title)}</h4>
    <p class="small muted">Source: ${esc(x.source || '')}</p>${tags ? `<div class="pill-row">${tags}</div>` : ''}${whyLine(x)}${noteLine(x)}${extra}</div></article>`;
}
// Overview of a company: its changes of the last 30 days and why they matter to you.
const briefRestore=id=>`<button class="link-btn co-brief-restore" data-i="brief-show" data-company="${esc(id)}">Show recent updates</button>`;
export async function companyBrief(companyId) {
  if(localStorage.getItem('emma:brief-hidden:'+companyId)==='1')return briefRestore(companyId);
  const b=await api('/market/brief?days=30&companies='+encodeURIComponent(companyId));
  const items=(b.companies[0]?.items||[]).filter(x=>x.dateBasis!=='discovered');
  window.__emmaBrief={...b,top:items};
  const row=x=>`<article class="co-brief-row"><time>${day(x.date)}</time><div>${link(x.url,x.title)}<small>${esc(x.label)} · ${esc(x.source||'')}${x.dateBasis==='event'?' · event date':x.dateBasis==='detected'?' · change detected':' · published'}</small>${x.aiText||x.whyText||x.notes?.length?`<details class="co-brief-reason"><summary>Why it matters</summary>${whyLine(x)}${noteLine(x)}</details>`:''}</div></article>`;
  return `<section class="panel co-brief co-brief-compact" data-company="${esc(companyId)}"><div class="co-brief-head"><div><h3>Recent updates</h3><span class="eyebrow">Last 30 days</span></div><button class="co-brief-hide" data-i="brief-hide" data-company="${esc(companyId)}" title="Hide this section" aria-label="Hide recent updates">×</button></div>${items.length?items.slice(0,3).map(row).join('')+(items.length>3?`<details class="co-brief-more"><summary>Show ${items.length-3} more updates</summary>${items.slice(3).map(row).join('')}</details>`:''):'<p class="small muted co-brief-empty">No updates with a verified date in this period. Older and undated sources remain in the other tabs.</p>'}${!b.profileReady&&items.length?'<a class="co-brief-personalise" href="#settings" data-i="goto-my-company">Personalise relevance to your company</a>':''}</section>`;
}
// Settings: your company, used to tell why a change matters.
export async function myCompanyPanel() {
  let p; try { p = await api('/market/my-company'); } catch { return ''; }
  return `<section class="panel set-card" id="my-company"><h2>Your company</h2>
  <p class="small">EMMA uses it to tell, for each change at the companies you follow, why it matters to you: your products (with their technical words), markets and customers named in the source.</p>
  ${p.name ? `<p><b>${esc(p.name)}</b> · ${p.products.length} products · ${p.markets.length} markets · ${p.customers.length} customers · ${p.competitors.length} direct competitors</p>` : '<p class="small muted">Not described yet.</p>'}
  <button class="btn ${p.name ? '' : 'primary'}" data-i="my-company">${p.name ? 'Edit' : 'Describe your company'}</button></section>`;
}
function briefText(b) {
  const lines = [`EMMA · weekly brief · ${new Date(b.generatedAt).toLocaleDateString('en-GB')}`, ''];
  for (const x of b.top) lines.push(`• ${x.companyName} — ${x.label}: ${x.title} (${x.source}, ${day(x.date)})`, `  ${x.aiText || x.whyText || x.whyGeneric || ''}`.trimEnd(), `  ${x.url}`, '');
  return lines.join('\n');
}

// ---------- Your company ----------
export async function myCompanyForm() {
  const [p, st] = await Promise.all([api('/market/my-company'), api('/market/state')]);
  const comp = new Set(p.competitors || []);
  const productRows = (p.products?.length ? p.products : [{ name: '', terms: [] }]).concat([{ name: '', terms: [] }]).map((x, i) => `<div class="mc-product"><input name="pname" placeholder="Product name" value="${esc(x.name)}" maxlength="120"><input name="pterms" placeholder="Technical words found in news, comma separated (e.g. 1500 V, backsheet, PET film)" value="${esc((x.terms || []).join(', '))}"></div>`).join('');
  const html = `<div class="dialog-head"><h2>Your company</h2><button type="button" aria-label="Close" data-action="close">×</button></div>
  <form id="myCompanyForm" class="mc-form"><p class="small muted">Used only on this computer, to tell which changes at your competitors concern you. Be specific: the words you write are searched in the news.</p>
  <div class="form-grid"><label>Name<input name="name" required maxlength="150" value="${esc(p.name)}"></label><label>Website<input name="website" value="${esc(p.website)}" placeholder="https://…"></label>
  <label class="full">What you do<textarea name="description" maxlength="2000">${esc(p.description)}</textarea></label></div>
  <h4>Products</h4><div id="mcProducts">${productRows}</div><button type="button" class="btn tiny" data-i="mc-add-product">＋ Product</button>
  <div class="form-grid"><label class="full">Markets you serve · comma separated<input name="markets" value="${esc((p.markets || []).join(', '))}" placeholder="Countries, regions and applications, e.g. India, Europe, photovoltaic, electric motors"></label>
  <label class="full">Key customers · comma separated<input name="customers" value="${esc((p.customers || []).join(', '))}" placeholder="Names as they appear in the news"></label></div>
  <h4>Direct competitors</h4><div class="mc-competitors">${st.companies.map(c => `<label class="choice"><input type="checkbox" name="competitor" value="${c.id}" ${comp.has(c.id) ? 'checked' : ''}>${esc(c.name)}</label>`).join('') || '<p class="small muted">Add companies in the Archive first.</p>'}</div>
  <div class="form-actions"><button type="button" class="btn ghost" data-action="close">Cancel</button><button class="btn primary">Save</button></div></form>`;
  $('#dialogContent').innerHTML = html; if (!$('#dialog').open) $('#dialog').showModal();
}
async function saveMyCompany(form) {
  const names = [...form.querySelectorAll('[name=pname]')], terms = [...form.querySelectorAll('[name=pterms]')];
  const body = { name: form.elements.name.value, website: form.elements.website.value, description: form.elements.description.value,
    products: names.map((n, i) => ({ name: n.value, terms: terms[i].value })).filter(x => x.name.trim()),
    markets: form.elements.markets.value, customers: form.elements.customers.value,
    competitors: [...form.querySelectorAll('[name=competitor]:checked')].map(x => x.value) };
  await api('/market/my-company', { method: 'PUT', body });
  $('#dialog').close(); toast('Company profile saved.'); rerender();
}

// ---------- What changed (top of the Daily) ----------
export async function whatChangedBox() {
  let w; try { w = await api('/market/what-changed'); } catch { return ''; }
  if (!w.items.length) return '';
  setTimeout(() => { api('/market/what-changed/seen', { method: 'POST' }).catch(() => {}); }, 4000);
  return `<section class="wc-box"><div class="wc-head"><div><div class="eyebrow">What changed</div><h2>${w.newCount ? `${w.newCount} new since your last visit` : 'The most important this week'}</h2></div></div>
  <ol class="wc-list">${w.items.map(x => `<li class="${x.isNew ? 'is-new' : ''}"><span class="wc-icon b-k-${esc(x.kind)}" title="${esc(x.label)}">${esc(x.icon)}</span><div><b>${esc(x.companyName)}</b> · ${esc(x.label)}${x.isNew ? ' <span class="pill accent">new</span>' : ''}<br><span class="wc-mark">${link(x.url, x.title)}</span> <span class="small muted">${esc(x.source)} · ${day(x.date)}</span>${x.whyText ? `<br><span class="small ok-text">${esc(x.whyText)}</span>` : ''}</div></li>`).join('')}</ol></section>`;
}

// ---------- What EMMA learned (Settings) ----------
export async function learningPanel() {
  let l; try { l = await api('/market/learning'); } catch { return ''; }
  const row = (d, kind, note) => `<li><b>${esc(d.domain || d.label)}</b>${d.companyName ? ` <span class="muted">· ${esc(d.companyName)}</span>` : ''} <span class="muted">${note}</span> <button class="btn tiny ghost" data-i="forget" data-kind="${kind}" data-key="${esc(d.domain || d.label)}" data-company="${esc(d.companyId || '')}" title="Forget these decisions">forget</button></li>`;
  const block = (title, items, kind, note, help) => items.length ? `<div><h4>${title}</h4><p class="small muted">${help}</p><ul class="learn-list">${items.map(d => row(d, kind, note(d))).join('')}</ul></div>` : '';
  return `<section class="panel set-card learning-panel" id="learning"><h2>What EMMA learned from you</h2>
  <p class="small">Each article you keep, discard, star or add, and each person you remove, adjusts the next searches. ${l.kept} kept · ${l.discarded} discarded · ${l.people} people removed.</p>
  ${!l.kept && !l.discarded ? '<p class="small muted">Nothing yet: approve or discard the articles “To review” in the Archive, and EMMA starts learning.</p>' : ''}
  <div class="learn-grid">
  ${block('Trusted sites', l.trusted, 'domain', d => `kept ${d.keep}, never discarded`, `Articles from these sites that name the company are accepted without review (after ${l.limits.trust} kept).`)}
  ${block('Sites you discard', [...l.blocked, ...l.demoted], 'domain', d => `discarded ${d.drop}, never kept${d.drop >= l.limits.block ? ' · filtered out' : ' · always to review'}`, `After ${l.limits.demote} discards they go to review; after ${l.limits.block} they are filtered out.`)}
  ${block('Searches skipped', l.skipped, 'search', d => `all ${d.drop} results discarded`, `A search whose results you always discarded (${l.limits.skipSearch} or more) is skipped for that company.`)}
  ${block('Most useful searches', l.useful, 'search', d => `${d.keep} kept · ${d.drop} discarded`, 'Searches whose results you keep most.')}
  </div><p class="small muted">Articles similar to ones you discarded are not proposed again. “Forget” deletes those decisions.</p></section>`;
}

// ---------- Getting started (top of the Daily, until done or hidden) ----------
export async function gettingStartedBox({ force = false } = {}) {
  let g; try { g = await api('/market/getting-started'); } catch { return ''; }
  const steps = [
    { done: g.search, title: 'Connect a web search service', text: 'EMMA needs one to find news, interviews and job openings. Tavily has a free monthly plan: create a key on tavily.com and paste it in Settings → Web search.', button: '<a class="btn tiny primary" href="#settings">Open Settings</a>' },
    { done: g.profile, title: 'Describe your company', text: 'Your products (with their technical words, e.g. “1500 V”, “backsheet”), markets, key customers and direct competitors. EMMA uses it to tell you why a change matters to you.', button: '<button class="btn tiny" data-i="my-company">Describe your company</button>' },
    { done: g.companies > 0, title: 'Add the companies you want to follow', text: `Name and official website for each one: the website is the most reliable source (team, products, news).${g.companies && g.withWebsite < g.companies ? ` ${g.companies - g.withWebsite} without website: add it with Edit.` : ''}`, button: '<button class="btn tiny" data-action="add-company">＋ Add company</button>' },
    { done: g.runs > 0, title: 'Run the first update', text: 'EMMA reads the official websites, news, interviews, LinkedIn, trade fairs, job openings and patents. The first time takes a few minutes per company; you can keep working.', button: g.companies ? '<button class="btn tiny primary" data-action="refresh">↻ Update now</button>' : '' },
    { done: g.decisions > 0, title: 'Check the items “To review”', text: `Approve or discard the doubtful items${g.review ? ` (${g.review} waiting)` : ''}. EMMA learns from you: sites you discard are filtered, sites you keep are trusted.`, button: '<a class="btn tiny" href="#archive">Open the Archive</a>' },
    { done: g.notes > 0, title: 'Write a post-it on a company', text: 'In a company’s page write what you want to know, e.g. “new plant in Vietnam?”. EMMA looks for it at every update and shows what it finds on the post-it.', button: '<a class="btn tiny" href="#archive">Open a company</a>' },
    { done: g.auto, title: 'Turn on the automatic update', text: 'Every day at the time you choose, plus a notification on your computer for important moves (new product, plant, acquisition…).', button: '<a class="btn tiny" href="#settings">Settings</a>' },
  ];
  const done = steps.filter(s => s.done).length;
  if (!force && (g.dismissed || done === steps.length)) return '';
  const next = steps.findIndex(s => !s.done);
  return `<section class="gs-box"><div class="gs-head"><div><div class="eyebrow">Getting started · ${done} of ${steps.length} done</div><h2>${done === steps.length ? 'All set' : 'How to use EMMA'}</h2></div><button class="link-btn" data-i="guide-hide">Hide the guide</button></div>
  <div class="gs-bar"><i style="width:${Math.round(done / steps.length * 100)}%"></i></div>
  <ol class="gs-steps">${steps.map((s, i) => `<li class="${s.done ? 'done' : ''} ${i === next ? 'next' : ''}"><span class="gs-num">${s.done ? '✓' : i + 1}</span><div><b>${s.title}</b><p class="small">${s.text}</p>${!s.done && s.button ? `<div class="gs-act">${s.button}</div>` : ''}</div></li>`).join('')}</ol>
  <p class="small muted gs-daily"><b>Every day after that:</b> open the Daily → read “What changed” → open the companies that matter (Overview: what changed and why it matters to you) → export a company's Word file when you need to share it.</p></section>`;
}
export function guidePanel() {
  return `<section class="panel set-card"><h2>How EMMA works</h2><p class="small">The step-by-step guide for new users: describe your company, add companies, first update, review, post-its, automatic update.</p><button class="btn" data-i="guide-show">Show the guide in the Daily</button></section>`;
}

// ---------- Post-its that EMMA follows ----------
export function noteWatchBlock(w) {
  if (!w) return '';
  if (!w.watch) return `<div class="postit-watch off"><span>EMMA does not follow this note.</span> <button class="link-btn" data-i="note-watch" data-on="1" data-id="${esc(w.id)}">Follow it</button></div>`;
  const f = w.findings || [];
  const found = f.length ? `<p class="pw-found"><b>Found ${w.total}:</b></p><ul class="pw-list">${f.slice(0, 3).map(x => `<li>${link(x.url, x.title)} <span class="muted">${esc(x.source)} · ${day(x.date || x.foundAt)}${x.review ? ' · to review' : ''}</span></li>`).join('')}</ul>${f.length > 3 ? `<details><summary>${w.total - 3} more</summary><ul class="pw-list">${f.slice(3).map(x => `<li>${link(x.url, x.title)} <span class="muted">${esc(x.source)} · ${day(x.date || x.foundAt)}</span></li>`).join('')}</ul></details>` : ''}` : `<p class="pw-none">Nothing found yet${w.lastCheckedAt ? ' · checked ' + day(w.lastCheckedAt) : ''}. EMMA searches again at each update.</p>`;
  return `<div class="postit-watch"><p class="pw-terms" title="EMMA searches: ${esc(w.query)}">🔎 ${w.terms.length ? 'Looks for: ' + w.terms.slice(0, 5).map(esc).join(', ') : 'Write names, places or products to look for'}</p>${found}<button class="link-btn pw-stop" data-i="note-watch" data-on="0" data-id="${esc(w.id)}">Stop following</button></div>`;
}

// ---------- Clicks and forms ----------
document.addEventListener('submit', async e => {
  if (e.target.id !== 'myCompanyForm') return;
  e.preventDefault(); e.stopImmediatePropagation();
  try { await saveMyCompany(e.target); } catch (x) { toast(x.message, true); }
}, true);
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-i]'); if (!b) return;
  const a = b.dataset.i;
  try {
    if(a==='brief-hide'){localStorage.setItem('emma:brief-hidden:'+b.dataset.company,'1');const section=b.closest('.co-brief');section?.insertAdjacentHTML('afterend',briefRestore(b.dataset.company));section?.remove();return;}
    if(a==='brief-show'){localStorage.removeItem('emma:brief-hidden:'+b.dataset.company);return rerender();}
    if (a === 'my-company') return await myCompanyForm();
    if (a === 'mc-add-product') { $('#mcProducts').insertAdjacentHTML('beforeend', '<div class="mc-product"><input name="pname" placeholder="Product name" maxlength="120"><input name="pterms" placeholder="Technical words, comma separated"></div>'); return; }
    if (a === 'brief-ai') { b.disabled = true; b.textContent = 'Writing…'; const r = await api('/market/brief/ai', { method: 'POST', body: { days: 30 } }); toast(`${r.written} sentences written from their sources.`); return rerender(); }
    if (a === 'brief-copy') { await navigator.clipboard.writeText(briefText(window.__emmaBrief)); toast('Brief copied: paste it in an email or a chat.'); return; }
    if (a === 'forget') { await api('/market/learning/forget', { method: 'POST', body: { kind: b.dataset.kind, key: b.dataset.key, companyId: b.dataset.company } }); toast('Forgotten.'); return rerender(); }
    if (a === 'guide-hide') { await api('/market/getting-started/dismiss', { method: 'POST', body: { dismissed: true } }); toast('Guide hidden. Show it again from Settings → How EMMA works.'); return rerender(); }
    if (a === 'guide-show') { await api('/market/getting-started/dismiss', { method: 'POST', body: { dismissed: false } }); location.hash = 'daily'; return; }
    if (a === 'note-watch') { await api('/market/notes/' + b.dataset.id + '/watch', { method: 'POST', body: { watch: b.dataset.on === '1' } }); toast(b.dataset.on === '1' ? 'EMMA follows this note again.' : 'EMMA stops following this note.'); return rerender(); }
    if (a === 'goto-my-company') { e.preventDefault(); location.hash = 'settings'; setTimeout(() => $('#my-company')?.scrollIntoView({ behavior: 'smooth' }), 600); return; }
  } catch (x) { toast(x.message, true); if (a === 'brief-ai') rerender(); }
});
