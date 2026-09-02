/* Log Lens — content script.
 * Two modes:
 *  1. Full-page: the document is raw JSON, or text with embedded JSON
 *     (raw log dumps) -> replace the whole body with the viewer.
 *  2. Inline: an HTML log viewer renders JSON blobs inside the page ->
 *     swap each blob for a viewer, keeping a "raw" toggle.
 *     A MutationObserver catches SPA re-renders.
 * A toolbar "off" button / floating pill switches between Log Lens and the
 * original view; OFF is remembered for the current tab only (sessionStorage),
 * so every new tab or session starts enhanced.
 *
 * When auto-registered, this script runs on the Chrome-legal SUPERSET of the
 * user's auto-run patterns (see background.js), so it re-checks location.href
 * against the patterns as typed before touching the page. Manual injection
 * from the toolbar button sets window.__logLensManual and skips that gate.
 */
(function () {
  'use strict';
  if (window.__logLensLoaded) {
    // already injected here — a second injection is the toolbar button asking
    // for the viewer, even if the auto-run gate had closed the first time
    if (window.__logLensRescan) window.__logLensRescan();
    return;
  }
  window.__logLensLoaded = true;

  const LL = window.LogLens;
  if (!LL) return;

  const MIN_INLINE_LEN = 80;      // ignore tiny JSON snippets — a tree adds nothing
  const MIN_JSON_RATIO = 0.4;     // JSON chars must dominate the block

  const OFF_KEY = 'll-off'; // sessionStorage: per-origin AND per-tab, gone in new tabs

  function readOff() {
    try { return sessionStorage.getItem(OFF_KEY) === '1'; } catch (e) { return false; }
  }
  function writeOff(off) {
    try {
      if (off) sessionStorage.setItem(OFF_KEY, '1');
      else sessionStorage.removeItem(OFF_KEY);
    } catch (e) { /* sandboxed context — state just won't survive reload */ }
  }

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
    const mounted = LL.mount(document.body, { segments: segs, rawText: text }, { full: true, onPowerOff: () => setEnabled(false, true) });
    registry.full = { originalNodes, viewer: mounted.root };
    document.title = '⌕ ' + document.title;
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
    LL.mount(holder, { segments: segs, rawText: text }, { onPowerOff: () => setEnabled(false, true) });
    registry.inline.push({ original: elm, holder });
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
    // drop candidates nested inside another candidate (ancestor walk, not O(n^2))
    const candSet = new Set(candidates);
    const top = candidates.filter((c) => {
      for (let a = c.parentElement; a; a = a.parentElement) {
        if (candSet.has(a)) return false;
      }
      return true;
    });
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
      mo.observe(document.body, { childList: true, subtree: true });
      moStarted = true;
    }
  }

  function setEnabled(on, persist) {
    if (on === enabled) { updateBadge(); return; }
    enabled = on;
    if (on) activate();
    applyEnabled();
    if (persist) writeOff(!on);
  }

  function makeDraggable(el) {
    let sx, sy, ox, oy, dragging = false, moved = false;
    el.addEventListener('pointerdown', (e) => {
      dragging = true;
      moved = false;
      sx = e.clientX; sy = e.clientY;
      const r = el.getBoundingClientRect();
      ox = r.left; oy = r.top;
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (Math.abs(dx) + Math.abs(dy) > 6) moved = true;
      if (moved) {
        el.style.left = Math.max(4, Math.min(window.innerWidth - el.offsetWidth - 4, ox + dx)) + 'px';
        el.style.top = Math.max(4, Math.min(window.innerHeight - el.offsetHeight - 4, oy + dy)) + 'px';
        el.style.right = 'auto';
        el.style.bottom = 'auto';
      }
    });
    el.addEventListener('pointerup', () => { dragging = false; });
    // a drag must not count as a click
    el.addEventListener('click', (e) => {
      if (moved) {
        e.stopImmediatePropagation();
        e.preventDefault();
        moved = false;
      }
    }, true);
  }

  function ensureBadge() {
    if (badgeEl) return;
    badgeEl = document.createElement('button');
    badgeEl.className = 'll-badge-toggle ll-off';
    badgeEl.textContent = '⌕ Log Lens OFF';
    badgeEl.title = 'Click to re-enable the JSON tree view · drag to move';
    badgeEl.addEventListener('click', () => setEnabled(true, true));
    makeDraggable(badgeEl);
    // attached to <html>, not <body>: survives full-page body swaps
    document.documentElement.appendChild(badgeEl);
  }

  function updateBadge() {
    // pill exists only while Log Lens is OFF; while ON the switch lives
    // in each viewer's toolbar ("off" button), which is never covered
    if (enabled) {
      if (badgeEl) badgeEl.style.display = 'none';
      return;
    }
    ensureBadge();
    badgeEl.style.display = '';
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

  function init() {
    if (!document.body) return;
    if (readOff()) enabled = false;
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
      try {
        chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
          if (!msg || typeof msg !== 'object') return;
          if (msg.type === 'll-get-state') {
            sendResponse({ active: true, enabled });
          } else if (msg.type === 'll-set-enabled') {
            setEnabled(!!msg.on, true);
            sendResponse({ active: true, enabled });
          }
        });
      } catch (e) { /* messaging unavailable — pill and toolbar still work */ }
    }
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
      try {
        chrome.storage.sync.get('theme').then((r) => {
          if (r && r.theme) LL.applyTheme(r.theme);
        }).catch(() => {});
        chrome.storage.onChanged.addListener((changes, area) => {
          if (area === 'sync' && changes.theme) LL.applyTheme(changes.theme.newValue || {});
        });
      } catch (e) { /* theme stays default */ }
    }
    if (enabled) activate();
    else updateBadge(); // page stays original, pill offers turning it on
  }

  /* ---------- auto-run gate ---------- */

  // Registration happens on a widened origin, so the real filter lives here.
  // Fails CLOSED: on a domain-wide grant, a failed read must not enhance pages
  // the user never asked for — the toolbar button is always the way in.
  async function autoRunAllowed() {
    if (window.__logLensManual) return true;
    const P = window.LLPatterns;
    if (!P) return false;
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.sync) return false;
    try {
      const { sites = [] } = await chrome.storage.sync.get('sites');
      return sites.some((pat) => P.matchesUrl(pat, location.href));
    } catch (e) {
      return false;
    }
  }

  let inited = false;
  function boot() {
    if (inited) { activate(); return; }
    inited = true;
    init();
  }

  window.__logLensRescan = () => {
    window.__logLensManual = true; // an explicit click outranks the gate
    if (!inited) { boot(); return; }
    if (!enabled) setEnabled(true, true); // manual toolbar click means "turn it on"
    else { activate(); }
  };

  (async () => {
    if (!(await autoRunAllowed())) return; // not an auto-run URL — leave the page alone
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', boot, { once: true });
    } else {
      boot();
    }
  })();
})();
