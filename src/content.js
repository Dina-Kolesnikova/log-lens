/* Log Lens — content script.
 * Two modes:
 *  1. Full-page: the document is raw JSON, or text with embedded JSON
 *     (raw log dumps) -> replace the whole body with the viewer.
 *  2. Inline: an HTML log viewer renders JSON blobs inside the page ->
 *     swap each blob for a viewer, keeping a "raw" toggle.
 *     A MutationObserver catches SPA re-renders.
 * A floating ON/OFF pill switches between Log Lens and the original view;
 * the choice is remembered per site (chrome.storage.local).
 */
(function () {
  'use strict';
  if (window.__logLensLoaded) {
    if (window.__logLensRescan) window.__logLensRescan();
    return;
  }
  window.__logLensLoaded = true;

  const LL = window.LogLens;
  if (!LL) return;

  const MIN_INLINE_LEN = 80;      // ignore tiny JSON snippets — a tree adds nothing
  const MIN_JSON_RATIO = 0.4;     // JSON chars must dominate the block

  const store = (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local)
    ? chrome.storage.local : null;
  const stateKey = 'll-off:' + location.origin;

  const registry = { inline: [], full: null };
  let enabled = true;
  let badgeEl = null;
  let moStarted = false;

  /* ---------- full page mode ---------- */

  function detectFullPageText() {
    const body = document.body;
    if (!body) return null;
    const ct = document.contentType || '';
    const singlePre = body.children.length === 1 && body.children[0].tagName === 'PRE';
    if (ct.includes('json') || ct === 'text/plain' || singlePre) {
      const text = singlePre ? body.children[0].textContent : body.innerText;
      if (text && text.trim()) return text;
    }
    return null;
  }

  function enhanceFullPage(text) {
    let segs;
    try { segs = LL.extractSegments(text); } catch (e) { return false; }
    const jsonChars = segs.filter((s) => s.type === 'json').reduce((a, s) => a + s.raw.length, 0);
    if (!jsonChars || jsonChars < text.length * MIN_JSON_RATIO) return false;
    const originalNodes = Array.from(document.body.childNodes);
    document.body.textContent = '';
    document.body.classList.add('ll-page');
    const mounted = LL.mount(document.body, { segments: segs, rawText: text }, { full: true });
    registry.full = { originalNodes, viewer: mounted.root };
    document.title = '⌕ ' + document.title;
    ensureBadge();
    return true;
  }

  /* ---------- inline mode ---------- */

  function looksLikeJsonBlock(t) {
    if (t.length < MIN_INLINE_LEN) return false;
    const c = t[0];
    return c === '{' || c === '[';
  }

  function enhanceInline(elm) {
    if (elm.dataset.llDone) return;
    const text = elm.textContent;
    const t = text.trim();
    let segs;
    try { segs = LL.extractSegments(t); } catch (e) { elm.dataset.llDone = 'no'; return; }
    const jsonChars = segs.filter((s) => s.type === 'json').reduce((a, s) => a + s.raw.length, 0);
    if (!jsonChars || jsonChars < t.length * MIN_JSON_RATIO) {
      elm.dataset.llDone = 'no';
      return;
    }
    elm.dataset.llDone = 'yes';
    const holder = document.createElement('div');
    holder.className = 'll-inline-holder';
    elm.parentNode.insertBefore(holder, elm.nextSibling);
    elm.classList.add('ll-hidden-original');
    LL.mount(holder, { segments: segs, rawText: text });
    registry.inline.push({ original: elm, holder });
    ensureBadge();
  }

  function scan(root) {
    if (!enabled || !root) return;
    const candidates = [];
    const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'SELECT', 'IFRAME', 'CANVAS', 'SVG']);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
      acceptNode(elm) {
        if (SKIP.has(elm.tagName)) return NodeFilter.FILTER_REJECT;
        if (elm.classList.contains('ll-root') || elm.classList.contains('ll-inline-holder')) {
          return NodeFilter.FILTER_REJECT;
        }
        if (elm.dataset.llDone) return NodeFilter.FILTER_REJECT;
        // leaf elements whose text is a JSON blob, or <pre>/<code> blocks
        // that may mix a preamble with JSON (raw-dump style)
        if (elm.childElementCount === 0) {
          const t = (elm.textContent || '').trim();
          return looksLikeJsonBlock(t) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
        }
        if (elm.tagName === 'PRE' || elm.tagName === 'CODE') {
          const t = (elm.textContent || '').trim();
          if (t.length >= MIN_INLINE_LEN && (t.includes('{') || t.includes('['))) {
            return NodeFilter.FILTER_ACCEPT;
          }
        }
        return NodeFilter.FILTER_SKIP;
      },
    });
    let n;
    while ((n = walker.nextNode())) candidates.push(n);
    // drop candidates nested inside another candidate
    const top = candidates.filter((c) => !candidates.some((o) => o !== c && o.contains(c)));
    top.forEach(enhanceInline);
  }

  /* ---------- on/off switch ---------- */

  function applyEnabled() {
    if (registry.full) {
      const body = document.body;
      if (enabled && !registry.full.viewer.isConnected) {
        body.textContent = '';
        body.classList.add('ll-page');
        body.appendChild(registry.full.viewer);
      } else if (!enabled && registry.full.viewer.isConnected) {
        registry.full.viewer.remove();
        body.classList.remove('ll-page');
        for (const nd of registry.full.originalNodes) body.appendChild(nd);
      }
    }
    for (const it of registry.inline) {
      it.holder.style.display = enabled ? '' : 'none';
      it.original.classList.toggle('ll-hidden-original', enabled);
    }
    updateBadge();
  }

  function activate() {
    if (registry.full) { applyEnabled(); return; }
    const text = detectFullPageText();
    if (text && enhanceFullPage(text)) return; // static page, no observer needed
    scan(document.body);
    if (!moStarted && document.body) {
      mo.observe(document.body, { childList: true, subtree: true, characterData: true });
      moStarted = true;
    }
  }

  function setEnabled(on, persist) {
    if (on === enabled) { updateBadge(); return; }
    enabled = on;
    if (on) activate();
    applyEnabled();
    if (persist && store) {
      if (on) store.remove(stateKey);
      else store.set({ [stateKey]: true });
    }
  }

  function ensureBadge() {
    if (badgeEl) return;
    badgeEl = document.createElement('button');
    badgeEl.className = 'll-badge-toggle';
    badgeEl.addEventListener('click', () => setEnabled(!enabled, true));
    // attached to <html>, not <body>: survives full-page body swaps
    document.documentElement.appendChild(badgeEl);
    updateBadge();
  }

  function updateBadge() {
    if (!badgeEl) return;
    badgeEl.textContent = enabled ? '⌕ Log Lens ON' : '⌕ Log Lens OFF';
    badgeEl.classList.toggle('ll-on', enabled);
    badgeEl.classList.toggle('ll-off', !enabled);
    badgeEl.title = enabled
      ? 'Switch back to the original log view (remembered for this site)'
      : 'Re-enable the JSON tree view';
  }

  /* ---------- SPA re-render handling ---------- */

  let pending = null;
  function schedule() {
    if (pending) return;
    pending = setTimeout(() => {
      pending = null;
      scan(document.body);
    }, 400);
  }

  const mo = new MutationObserver((muts) => {
    if (!enabled) return;
    for (const m of muts) {
      const target = m.target;
      if (target && target.nodeType === 1 &&
          (target.closest('.ll-root') || target.closest('.ll-inline-holder'))) continue;
      if (m.type === 'characterData') {
        const p = target.parentElement;
        if (p && (p.closest('.ll-root') || p.closest('.ll-inline-holder'))) continue;
        schedule();
        return;
      }
      for (const nd of m.addedNodes) {
        if (nd.nodeType !== 1 && nd.nodeType !== 3) continue;
        const e = nd.nodeType === 1 ? nd : nd.parentElement;
        if (e && (e.closest('.ll-root') || e.closest('.ll-inline-holder') ||
                  e.classList && e.classList.contains('ll-badge-toggle'))) continue;
        schedule();
        return;
      }
    }
  });

  /* ---------- init ---------- */

  async function init() {
    if (!document.body) return;
    if (store) {
      try {
        const st = await store.get(stateKey);
        if (st && st[stateKey]) enabled = false;
      } catch (e) { /* storage unavailable — stay enabled */ }
      try {
        chrome.storage.onChanged.addListener((changes, area) => {
          if (area === 'local' && stateKey in changes) {
            setEnabled(!changes[stateKey].newValue, false);
          }
        });
      } catch (e) { /* no listener — badge still works */ }
    }
    if (enabled) activate();
    else ensureBadge(); // page stays original, pill offers turning it on
  }

  window.__logLensRescan = () => {
    if (!enabled) setEnabled(true, true); // manual toolbar click means "turn it on"
    else { activate(); }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
