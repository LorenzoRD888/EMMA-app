// Welcome screen. Opens by itself at start when no AI is ready, and can be
// reopened from Settings (any element with data-w="open").
//   · Data from a previous EMMA: bring companies, news and settings into this version.
//   · Local AI or no AI: advantages and disadvantages of each.
//   · Local AI in three steps: 1 Ollama, 2 model (already on the computer, suggested or searched), 3 test.
const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
async function api(p, opts = {}) {
  const r = await fetch('/api/setup' + p, { method: opts.method || 'GET', headers: { 'Content-Type': 'application/json' }, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Error(j.error || 'Operation failed.');
  return j;
}
const gb = b => (b / 1e9).toFixed(1).replace('.0', '') + ' GB';
const day = v => v ? new Date(v).toLocaleDateString('en-GB', { dateStyle: 'medium' }) : '—';

const W = { st: null, prev: null, prevOpen: false, prevPath: '', importing: '', imported: null, mode: null, chosen: '', q: '', results: null, searching: false, custom: '', testing: false, done: '', error: '', sig: '' };
let timer = null;

const isInstalled = id => !!id && (W.st?.ollama.models || []).some(m => m === id || m === id + ':latest');

// ---------- Data from a previous EMMA ----------
// The user pastes the path of the old EMMA folder: EMMA does not search the disk by itself.
const isWin = () => W.st?.platform === 'win32';
function pathHelp() {
  return isWin()
    ? `<ol class="small w-list"><li>Open the old EMMA folder in File Explorer (the one that contains the <b>data</b> folder).</li><li>Click the address bar at the top, or right-click the folder and choose <b>Copy as path</b>.</li><li>Paste it here (Ctrl+V).</li></ol>`
    : `<ol class="small w-list"><li>Find the old EMMA folder in Finder (the one that contains the <b>data</b> folder).</li><li>Right-click it, hold <b>⌥ Option</b> and choose <b>Copy “EMMA” as Pathname</b>.</li><li>Paste it here (⌘V).</li></ol>`;
}
function previousBox() {
  const empty = !W.st.companies;
  if (W.imported) return `<section class="w-card done"><h3>✓ Data brought from the previous EMMA</h3><p class="small">${W.imported.companies} companies, ${W.imported.news} news items and ${W.imported.people} people are now in this EMMA. The copy of the data that was here before is kept in <code>data/backups</code>. ${esc(W.imported.settingsNote || 'Settings and keys were copied too.')}</p></section>`;
  // A new, empty EMMA: ask first, clearly, whether an older EMMA is already on this computer.
  if (!W.prevOpen && empty && !W.prevNo) return `<section class="w-card w-first"><h3>Is EMMA already on this computer?</h3>
    <p class="small">If you used an older version of EMMA, this new version can take its companies, news, people, notes, settings and keys. Nothing is lost and the old folder is not changed.</p>
    <div class="actions"><button class="btn primary" data-w="prev-toggle">Yes, update it and keep my data</button><button class="btn" data-w="prev-no">No, this is my first time</button></div></section>`;
  if (!W.prevOpen) return `<p class="small muted">${empty ? 'Updating from an older EMMA?' : 'Have data in an older EMMA?'} <button class="link-btn" data-w="prev-toggle">Bring its companies and news here</button></p>`;
  const f = W.prev;
  const found = f ? `<div class="w-prev"><div><b>${esc(f.name)}</b>${f.version ? ` <span class="pill">version ${esc(f.version)}</span>` : ''}<br><span class="small muted">${esc(f.path)}</span><br><span class="small">${f.companies} companies · ${f.news} news · ${f.people} people · last update ${day(f.lastUpdate || f.modified)}</span>${f.names?.length ? `<br><span class="small muted">${f.names.map(esc).join(', ')}${f.companies > f.names.length ? '…' : ''}</span>` : ''}</div><button class="btn primary" data-w="import" data-path="${esc(f.path)}" ${W.importing ? 'disabled' : ''}>${W.importing ? '<span class="spinner">◌</span> Bringing…' : 'Bring these data here'}</button></div>` : '';
  return `<section class="w-card"><h3>Data from a previous EMMA</h3>
    <p class="small">Tell EMMA where the old version is: it brings companies, news, people, notes, settings and keys into this version. The old folder is not changed${empty ? '' : '; what is in this EMMA now is saved in <code>data/backups</code> and then replaced'}.</p>
    ${pathHelp()}
    <div class="w-inline"><input id="wPrevPath" placeholder="${isWin() ? 'e.g. C:\\Users\\name\\Documents\\EMMA' : 'e.g. /Users/name/Desktop/EMMA'}" value="${esc(W.prevPath)}"><button class="btn" data-w="prev-look">Check folder</button></div>
    ${W.prevError ? `<p class="notice">${esc(W.prevError)}</p>` : ''}
    ${found}</section>`;
}

// ---------- With or without AI ----------
function choiceBox() {
  const card = (mode, title, pros, cons) => `<label class="w-choice ${W.mode === mode ? 'sel' : ''}"><input type="radio" name="wMode" value="${mode}" ${W.mode === mode ? 'checked' : ''}><div><b>${title}</b><ul class="w-pros">${pros.map(x => `<li>${x}</li>`).join('')}</ul><ul class="w-cons">${cons.map(x => `<li>${x}</li>`).join('')}</ul></div></label>`;
  return `<h3 class="w-title">How do you want to use EMMA?</h3><div class="w-choices">
    ${card('local', 'With the local AI', ['Summaries of news and websites, automatic categories', 'AI profile of each company and answers to your questions on the news', 'Private and free: runs on this computer, nothing leaves it'], ['Download of 3–8 GB and some disk space', 'Uses memory and processor while it works: slower than cloud AI', 'Summaries are good but less precise than the best cloud models'])}
    ${card('none', 'Without AI', ['Nothing to install: EMMA is ready now and stays light and fast', 'Collects everything anyway: news, websites, fairs, people, LinkedIn, key facts, alerts and the Word export', 'You read the original sources yourself'], ['No summaries and no automatic categories', 'No AI company profile and no questions on the news', 'You can add the AI later in Settings'])}
  </div><p class="small muted">A cloud AI (Anthropic or a compatible service, with a paid key) can also be set in Settings.</p>`;
}

// ---------- Local AI, three steps ----------
function stepsBox() {
  const st = W.st, running = st.ollama.running;
  if (st.pull?.status === 'done' && st.pull.model === W.chosen) W.confirmed = true;
  const installed = isInstalled(W.chosen) && W.confirmed;
  const active = !running ? 1 : !installed ? 2 : 3;
  const pull = st.pull || {};
  const pct = pull.total ? Math.min(100, Math.round(pull.completed / pull.total * 100)) : 0;
  const head = (n, title, ok) => `<div class="w-step-head"><span class="w-num ${ok ? 'ok' : n === active ? 'on' : ''}">${ok ? '✓' : n}</span><h3>${title}</h3>${ok && n === 2 ? `<span class="small muted">${esc(W.chosen)} · <button class="link-btn" data-w="change-model">change</button></span>` : ''}</div>`;
  const step = (n, title, ok, body) => `<section class="w-step ${n === active ? 'active' : ''} ${ok ? 'done' : ''}">${head(n, title, ok)}${n === active || (n === 3 && W.done) ? `<div class="w-body">${body}</div>` : ok ? '' : '<p class="small muted w-body">Available after the previous step.</p>'}</section>`;

  const s1 = `<p>Ollama is the free program that runs the AI on this computer.</p>
    ${isWin()
      ? `<ol class="small w-list"><li>Download Ollama for Windows and open <b>OllamaSetup.exe</b>.</li><li>Follow the installer: at the end Ollama starts and a llama icon appears near the clock in the taskbar.</li><li>Come back here: EMMA notices it by itself.</li></ol>
         <div class="actions"><a class="btn primary" href="https://ollama.com/download/windows" target="_blank" rel="noopener noreferrer">Download Ollama for Windows ↗</a><button class="btn" data-w="refresh">Check again</button></div>`
      : `<ol class="small w-list"><li>Download Ollama and open the downloaded file.</li><li>Drag <b>Ollama</b> into <b>Applications</b> and open it: a llama icon appears in the menu bar at the top.</li><li>Come back here: EMMA notices it by itself.</li></ol>
         <div class="actions"><a class="btn primary" href="https://ollama.com/download/mac" target="_blank" rel="noopener noreferrer">Download Ollama for Mac ↗</a><button class="btn" data-w="refresh">Check again</button></div>`}
    <p class="small muted"><span class="spinner">◌</span> Waiting for Ollama… If the download does not start or stops, turn off any VPN and try again.</p>`;

  const mine = st.ollama.installed || [];
  const radio = (id, label, sub, extra = '') => `<label class="w-model ${id === W.chosen ? 'sel' : ''}"><input type="radio" name="wModel" value="${esc(id)}" ${id === W.chosen ? 'checked' : ''}><span><b>${esc(label)}</b>${extra}<br><span class="small muted">${sub}</span></span></label>`;
  const installedList = mine.length ? `<h4 class="w-sub">Already on this computer: just choose one</h4><div class="w-models">${mine.map(m => radio(m.name, m.name, [m.params, m.family, gb(m.size)].filter(Boolean).map(esc).join(' · '), m.name === st.localModel ? ' <span class="pill ok">in use</span>' : '')).join('')}</div>` : '';
  const suggested = st.models.filter(m => !m.installed).map(m => radio(m.id, m.label, `${esc(m.size)} · ${esc(m.note)}${m.fits ? '' : ` Needs at least ${m.minRam} GB of memory: this computer has ${st.ramGB} GB.`}`, m.id === st.recommended ? ' <span class="pill ok">recommended for this computer</span>' : '')).join('');
  const results = W.results === null ? '' : W.results.length ? `<div class="w-results">${W.results.map(r => `<div class="w-result"><div><b>${esc(r.name)}</b>${r.capabilities.length ? ' ' + r.capabilities.map(c => `<span class="pill">${esc(c)}</span>`).join(' ') : ''}<br><span class="small muted">${esc(r.description)}${r.pulls ? ' · ' + esc(r.pulls) + ' downloads' : ''}${r.updated ? ' · updated ' + esc(r.updated) : ''}</span></div><div class="w-sizes">${(r.sizes.length ? r.sizes : ['latest']).map(s => { const id = s === 'latest' ? r.name : `${r.name}:${s}`; return `<button class="btn tiny ${id === W.chosen ? 'primary' : ''}" data-w="pick" data-id="${esc(id)}">${esc(s)}</button>`; }).join('')}</div></div>`).join('')}</div><p class="small muted">The size (e.g. 8b = 8 billion parameters) sets quality and weight: on a computer with ${st.ramGB} GB of memory choose sizes up to about ${Math.max(3, Math.floor(st.ramGB * 0.6))}b.</p>` : '<p class="small muted">No model found with that name.</p>';
  const download = pull.status === 'running'
    ? `<p class="small">${esc(pull.message || 'Downloading…')} <b>${esc(pull.model)}</b> ${pull.total ? `· ${gb(pull.completed)} of ${gb(pull.total)} · ${pct}%` : ''}</p><div class="bar w-bar"><i style="width:${pct}%"></i></div><p class="small muted">You can keep using EMMA: the download continues in the background. Keep the computer awake and connected.</p>`
    : `<h4 class="w-sub">${mine.length ? 'Or download another model' : 'Download a model'}</h4>${suggested ? `<div class="w-models">${suggested}</div>` : ''}
      <div class="w-inline"><input id="wSearch" placeholder="Search other models on ollama.com (e.g. qwen, llama, mistral)" value="${esc(W.q)}"><button class="btn" data-w="search" ${W.searching ? 'disabled' : ''}>${W.searching ? 'Searching…' : 'Search'}</button></div>
      ${W.searchError ? `<p class="notice">${esc(W.searchError)} <a href="https://ollama.com/search" target="_blank" rel="noopener noreferrer">ollama.com/search ↗</a></p>` : ''}${results}
      <div class="w-inline"><input id="wCustom" placeholder="Or type the exact name, e.g. qwen3:8b" value="${esc(W.custom)}"><button class="btn" data-w="pick-custom">Use this name</button></div>
      ${pull.status === 'failed' ? `<p class="notice">${esc(pull.error)}</p>` : ''}
      ${W.chosen && !isInstalled(W.chosen) ? `<div class="actions"><button class="btn primary" data-w="pull">Download ${esc(W.chosen)}</button></div>` : ''}`;
  const useBtn = W.chosen && isInstalled(W.chosen) ? `<div class="actions"><button class="btn primary" data-w="confirm">Use ${esc(W.chosen)}</button></div>` : '';
  const s2 = `${installedList}${useBtn}${download}`;

  const s3 = W.done
    ? `<p class="notice success"><b>EMMA is ready with ${esc(W.done)}.</b> The local AI now writes the summaries and analyses. You can change it any time in Settings.</p><div class="actions"><button class="btn primary" data-w="finish">Start using EMMA</button></div>`
    : `<p>EMMA turns on <b>${esc(W.chosen)}</b> and asks it a short question. The first answer can take up to a minute while the model loads.</p>
       <div class="actions"><button class="btn primary" data-w="use" ${W.testing ? 'disabled' : ''}>${W.testing ? '<span class="spinner">◌</span> Testing…' : 'Turn on and test'}</button><button class="btn ghost" data-w="change-model">Choose another model</button></div>`;

  return `<div class="w-steps">${step(1, 'Install Ollama', running, s1)}${step(2, 'Choose the AI model', running && installed, s2)}${step(3, 'Test and start', !!W.done, s3)}</div>`;
}

function view() {
  const noneDone = W.done === 'none';
  return `<div class="dialog-head"><div><div class="eyebrow">Welcome to EMMA</div><h2>Let's get EMMA ready</h2></div><button type="button" aria-label="Close" data-w="close">×</button></div>
    ${W.error ? `<p class="notice">${esc(W.error)}</p>` : ''}
    ${previousBox()}
    ${noneDone ? `<p class="notice success"><b>EMMA is ready without AI.</b> Add a company and press “Update” in the Daily. You can turn on an AI any time in Settings.</p><div class="form-actions"><button class="btn primary" data-w="finish">Start using EMMA</button></div>` : `
    ${choiceBox()}
    ${W.mode === 'local' ? stepsBox() : ''}
    ${W.mode === 'none' ? `<div class="form-actions"><button class="btn primary" data-w="no-ai">Continue without AI</button></div>` : ''}
    ${W.done ? '' : `<div class="form-actions"><button class="btn ghost" data-w="skip">Decide later</button></div>`}`}`;
}

function paint() { if (!$('#dialog').open || !$('#dialogContent .w-root')) return; $('#dialogContent .w-root').innerHTML = view(); }

async function refresh(force = false) {
  let st; try { st = await api('/status'); } catch { return; }
  W.st = st;
  if (!W.mode && (st.provider === 'local' || st.ollama.running)) W.mode = 'local';
  if (st.pull?.status === 'running' && st.pull.model) W.chosen = st.pull.model;
  if (!W.chosen && !W.picking) W.chosen = (st.localModel && isInstalled(st.localModel) && st.localModel) || st.ollama.installed?.[0]?.name || st.recommended;
  // Repaint only when something changed, so typing in the search field is not interrupted.
  const sig = JSON.stringify([st.ollama.running, st.ollama.models, st.pull?.status, st.pull?.completed, st.provider]);
  if (force || sig !== W.sig) { W.sig = sig; paint(); }
}

async function open() {
  Object.assign(W, { prev: null, prevError: '', confirmed: false, picking: false, error: '', done: '', testing: false, results: null, imported: null, prevOpen: false, sig: '' });
  await refresh(); if (!W.st) return;
  $('#dialogContent').innerHTML = `<div class="w-root">${view()}</div>`;
  if (!$('#dialog').open) $('#dialog').showModal();
  clearInterval(timer);
  timer = setInterval(() => { if (!$('#dialog').open || !$('#dialogContent .w-root')) { clearInterval(timer); timer = null; return; } refresh(); }, 2500);
}

document.addEventListener('input', e => { if (e.target.id === 'wSearch') W.q = e.target.value; if (e.target.id === 'wCustom') W.custom = e.target.value; if (e.target.id === 'wPrevPath') W.prevPath = e.target.value; });
document.addEventListener('keydown', e => { if (e.key !== 'Enter') return; const id = e.target.id; if (id === 'wSearch' || id === 'wCustom' || id === 'wPrevPath') { e.preventDefault(); $(`[data-w="${id === 'wSearch' ? 'search' : id === 'wCustom' ? 'pick-custom' : 'prev-look'}"]`)?.click(); } });
document.addEventListener('change', e => {
  if (e.target.name === 'wModel') { W.chosen = e.target.value; paint(); }
  if (e.target.name === 'wMode') { W.mode = e.target.value; paint(); }
});
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-w]'); if (!b) return;
  const w = b.dataset.w; W.error = '';
  try {
    if (w === 'open') return open();
    if (w === 'close') { $('#dialog').close(); return; }
    if (w === 'refresh') return refresh(true);
    if (w === 'skip') { await api('/dismiss', { method: 'POST', body: { dismissed: true } }); $('#dialog').close(); return; }
    if (w === 'prev-toggle') { W.prevOpen = true; return paint(); }
    if (w === 'prev-no') { W.prevNo = true; return paint(); }
    if (w === 'prev-look') { if (!W.prevPath.trim()) return; W.prev = null; W.prevError = ''; try { W.prev = await api('/inspect?path=' + encodeURIComponent(W.prevPath.trim())); } catch (x) { W.prevError = x.message; } return paint(); }
    if (w === 'import') {
      const path = b.dataset.path;
      if (W.st.companies && !confirm(`Replace the ${W.st.companies} companies now in this EMMA with the data of ${path}? A backup copy is kept in data/backups.`)) return;
      W.importing = path; paint();
      try { W.imported = await api('/import', { method: 'POST', body: { path } }); } finally { W.importing = ''; }
      await refresh(true); return paint();
    }
    if (w === 'no-ai') { await api('/no-ai', { method: 'POST' }); W.done = 'none'; return paint(); }
    if (w === 'search') { if (!W.q.trim()) return; W.searching = true; paint(); W.searchError = ''; try { W.results = (await api('/search?q=' + encodeURIComponent(W.q.trim()))).results; } catch (x) { W.results = null; W.searchError = x.message; } finally { W.searching = false; } return paint(); }
    if (w === 'pick') { W.chosen = b.dataset.id; return paint(); }
    if (w === 'pick-custom') { const v = W.custom.trim().toLowerCase(); if (!/^[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*)?(:[a-z0-9][a-z0-9._-]*)?$/.test(v)) throw Error('Write a model name like qwen3:8b'); W.chosen = v; return paint(); }
    if (w === 'change-model') { W.chosen = ''; W.picking = true; W.confirmed = false; return paint(); }
    if (w === 'confirm') { W.confirmed = true; return paint(); }
    if (w === 'pull') { b.disabled = true; await api('/pull', { method: 'POST', body: { model: W.chosen } }); return refresh(true); }
    if (w === 'use') { W.testing = true; paint(); try { const r = await api('/use', { method: 'POST', body: { model: W.chosen } }); W.done = r.model; } finally { W.testing = false; } return paint(); }
    if (w === 'finish') { $('#dialog').close(); location.reload(); }
  } catch (x) { W.error = x.message; paint(); }
});

// First start: open by itself when EMMA is still empty (to offer bringing the data of an older EMMA)
// or no AI is ready, unless the screen was closed with "Decide later".
(async () => {
  try { const s = await api('/status'); if (!s.dismissed && (!s.companies || !s.aiReady)) setTimeout(open, 400); } catch {}
})();
window.emmaWelcome = open;
