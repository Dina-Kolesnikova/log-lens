/* Log Lens — content script.
 * Two modes:
 *  1. Full-page: the document is raw JSON, or text with embedded JSON
 *     (raw log dumps) -> replace the whole body with the viewer.
 *  2. Inline: an HTML log viewer renders JSON blobs inside the page ->
 *     swap each blob for a viewer, keeping a "raw" toggle.
 *     A MutationObserver catches SPA re-renders.
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

  /* ---------- full page mode ---------- */

  function enhanceFullPage(text) {
    let segs;
    try { segs = LL.extractSegments(text); } catch (e) { return false; }
    const jsonChars = segs.filter((s) => s.type === 'json').reduce((a, s) => a + s.raw.length, 0);
    if (!jsonChars || jsonChars < text.length * MIN_JSON_RATIO) return false;
    document.body.textContent = '';
    document.body.classList.add('ll-page');
    LL.mount(document.body, { segments: segs, rawText: text }, { full: true });
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
    LL.mount(holder, { segments: segs, rawText: text });
  }

  function scan(root) {
    if (!root) return;
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
        // that may mix a preamble with JSON (log-raw style)
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
        if (e && (e.closest('.ll-root') || e.closest('.ll-inline-holder'))) continue;
        schedule();
        return;
      }
    }
  });

  /* ---------- init ---------- */

  function init() {
    const body = document.body;
    if (!body) return;
    const ct = document.contentType || '';
    const singlePre = body.children.length === 1 && body.children[0].tagName === 'PRE';
    if (ct.includes('json') || ct === 'text/plain' || singlePre) {
      const text = singlePre ? body.children[0].textContent : body.innerText;
      if (text && text.trim() && enhanceFullPage(text)) return; // static page, no observer needed
    }
    scan(body);
    mo.observe(body, { childList: true, subtree: true, characterData: true });
  }

  window.__logLensRescan = () => scan(document.body);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
