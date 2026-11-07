// Link safety: every external link shown by EMMA gets a check.
//   ✓ green   trusted (followed company, site you keep, well-known publisher)
//   no sign   nothing found (hover the link for details)
//   ⚠ orange  doubt, with the reason in the tooltip
//   ⛔ red     dangerous: clicking asks for confirmation first
// An indication, not a guarantee: the checks are explained in Settings → Extra sources.
const cache = new Map();
let timer = null, busy = false;
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SIGN = { trusted: '✓', warn: '⚠', danger: '⛔' };
const TITLE = { trusted: 'Trusted source', ok: 'Link check: no problem found', warn: 'Be careful', danger: 'Dangerous link' };

function links(root = document) { return [...root.querySelectorAll('a[href^="http"]')].filter(a => !a.dataset.ls && !a.closest('.ls-skip') && new URL(a.href).host !== location.host); }

function mark(a, r) {
  a.dataset.ls = r.level;
  const why = `${TITLE[r.level]}: ${r.reasons.join(' · ')}${r.google ? ' · checked with Google Safe Browsing' : ''}`;
  a.title = a.title ? `${a.title}\n${why}` : why;
  a.classList.add('ls-link', 'ls-' + r.level);
  // Buttons keep their shape: the sign goes inside them (CSS); plain links get a sign next to them.
  if (SIGN[r.level] && !a.classList.contains('btn') && !a.nextElementSibling?.classList.contains('ls')) a.insertAdjacentHTML('afterend', `<span class="ls ls-${r.level}" title="${esc(why)}" aria-label="${esc(why)}">${SIGN[r.level]}</span>`);
}

async function scan() {
  if (busy) return; busy = true;
  try {
    const todo = links();
    for (const a of todo) if (cache.has(a.href)) mark(a, cache.get(a.href));
    const urls = [...new Set(todo.filter(a => !cache.has(a.href)).map(a => a.href))].slice(0, 600);
    if (urls.length) {
      const r = await fetch('/api/market/links/safety', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ urls }) }).then(x => x.json()).catch(() => null);
      for (const [u, v] of Object.entries(r?.results || {})) cache.set(u, { ...v, google: !!v.google });
      for (const a of links()) if (cache.has(a.href)) mark(a, cache.get(a.href));
    }
  } finally { busy = false; }
}
const soon = () => { clearTimeout(timer); timer = setTimeout(scan, 250); };
new MutationObserver(soon).observe(document.body, { childList: true, subtree: true });
soon();

// Dangerous links: ask before opening.
document.addEventListener('click', e => {
  const a = e.target.closest('a[data-ls="danger"]'); if (!a) return;
  const r = cache.get(a.href);
  if (!confirm(`EMMA thinks this link is dangerous:\n\n${(r?.reasons || []).join('\n')}\n\n${a.href}\n\nOpen it anyway?`)) { e.preventDefault(); e.stopImmediatePropagation(); }
}, true);
