/* Log Lens — dependency-free interactive JSON tree renderer.
 * Runs entirely in the page; nothing leaves the browser.
 * Exposes window.LogLens = { mount, extractSegments }.
 */
(function () {
  'use strict';
  if (window.LogLens) return;

  const MAX_MATCHES = 2000;     // search result cap
  const CHUNK = 200;            // children rendered per batch for huge arrays/objects
  const EXPAND_BUDGET = 25000;  // node cap for "expand all"
  const TRUNC = 400;            // long-string display truncation

  /* ---------------- utils ---------------- */

  function isObj(v) { return v !== null && typeof v === 'object'; }

  function typeOf(v) {
    if (v === null) return 'null';
    if (Array.isArray(v)) return 'array';
    return typeof v;
  }

  // A string value that itself contains JSON (extremely common in logs:
  // stringified bodies, "session data", etc.) gets parsed and rendered as a subtree.
  function tryParseJsonString(s) {
    if (typeof s !== 'string' || s.length < 4 || s.length > 5_000_000) return null;
    const t = s.trim();
    const c = t[0];
    if (c !== '{' && c !== '[') return null;
    try {
      const v = JSON.parse(t);
      return isObj(v) ? v : null;
    } catch (e) { return null; }
  }

  function pathToString(path) {
    let out = '$';
    for (const p of path) {
      if (typeof p === 'number') out += '[' + p + ']';
      else if (/^[A-Za-z_$][A-Za-z0-9_$-]*$/.test(p)) out += '.' + p;
      else out += '["' + String(p).replace(/"/g, '\\"') + '"]';
    }
    return out;
  }

  // Fires only for a real click: not after a drag, and not while the user
  // has text selected — so selecting text in the tree never toggles a node.
  function onPlainClick(target, fn) {
    let sx = 0, sy = 0;
    target.addEventListener('mousedown', (e) => { sx = e.clientX; sy = e.clientY; });
    target.addEventListener('click', (e) => {
      if (Math.abs(e.clientX - sx) + Math.abs(e.clientY - sy) > 5) return;
      const seltxt = window.getSelection ? String(window.getSelection()) : '';
      if (seltxt) return;
      fn(e);
    });
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function summarize(v) {
    if (Array.isArray(v)) return '[ ' + v.length + (v.length === 1 ? ' item' : ' items') + ' ]';
    const n = Object.keys(v).length;
    return '{ ' + n + (n === 1 ? ' key' : ' keys') + ' }';
  }

  function legacyCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0;';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) { /* best effort */ }
    ta.remove();
  }

  function copyText(text, btn) {
    const done = () => {
      if (!btn) return;
      const old = btn.textContent;
      btn.textContent = '✓';
      setTimeout(() => { btn.textContent = old; }, 700);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, () => { legacyCopy(text); done(); });
    } else { legacyCopy(text); done(); }
  }

  /* ---------------- pins (watch strip) ---------------- */
  // Pinned key names live in chrome.storage.sync (shape ready for named sets;
  // v1 uses one 'default' set). Outside an extension context (plain pages,
  // node/vm tests) pins still work in-memory for the page's lifetime.

  const pins = { keys: [], raw: null, listeners: [], inited: false };

  function pinsStorage() {
    try { return typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync ? chrome.storage.sync : null; }
    catch (e) { return null; }
  }

  function notifyPins() {
    for (const f of pins.listeners) { try { f(); } catch (e) { /* one bad strip must not break the rest */ } }
  }

  function pinsFromRaw(raw) {
    if (!raw || !raw.sets) return [];
    const set = raw.sets[raw.activeSet || 'default'];
    return Array.isArray(set) ? set : [];
  }

  function initPins() {
    if (pins.inited) return;
    pins.inited = true;
    const st = pinsStorage();
    if (!st) return;
    try {
      st.get('pins').then((r) => {
        if (r && r.pins) { pins.raw = r.pins; pins.keys = pinsFromRaw(r.pins); notifyPins(); }
      }).catch(() => {});
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'sync' || !changes.pins) return;
        pins.raw = changes.pins.newValue || null;
        pins.keys = pinsFromRaw(pins.raw);
        notifyPins();
      });
    } catch (e) { /* pins stay in-memory */ }
  }

  function setPinnedKeys(keys) {
    pins.keys = keys;
    notifyPins();
    const st = pinsStorage();
    if (!st) return;
    const raw = pins.raw && pins.raw.sets ? pins.raw : { activeSet: 'default', sets: {} };
    raw.sets[raw.activeSet || 'default'] = keys;
    pins.raw = raw;
    try { st.set({ pins: raw }); } catch (e) { /* in-memory only */ }
  }

  function togglePin(key) {
    setPinnedKeys(pins.keys.includes(key) ? pins.keys.filter((k) => k !== key) : pins.keys.concat([key]));
  }

  /* ---------------- value tooltips ---------------- */

  function relTime(d) {
    const s = Math.round((Date.now() - d.getTime()) / 1000);
    const abs = Math.abs(s), suf = s >= 0 ? ' ago' : ' from now';
    if (abs < 60) return abs + 's' + suf;
    if (abs < 3600) return Math.round(abs / 60) + 'm' + suf;
    if (abs < 86400) return Math.round(abs / 3600) + 'h' + suf;
    if (abs < 86400 * 60) return Math.round(abs / 86400) + 'd' + suf;
    return Math.round(abs / (86400 * 30)) + 'mo' + suf;
  }

  function fmtDate(d) { return d.toLocaleString() + ' — ' + relTime(d); }

  // 10/13-digit integers in a plausible date range (2001–2049) read as epochs
  function epochTooltip(n) {
    if (!Number.isInteger(n)) return null;
    let ms = null;
    if (n >= 1e9 && n < 2.5e9) ms = n * 1000;
    else if (n >= 1e12 && n < 2.5e12) ms = n;
    if (ms === null) return null;
    return fmtDate(new Date(ms));
  }

  function valueTooltip(v) {
    if (typeof v === 'string') {
      if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) {
        const d = new Date(v);
        if (!isNaN(d.getTime())) return fmtDate(d);
      }
      if (/^\d{10}$|^\d{13}$/.test(v)) return epochTooltip(Number(v));
      return null;
    }
    if (typeof v === 'number' && Number.isFinite(v)) {
      const ep = epochTooltip(v);
      if (ep) return ep;
      if (Number.isInteger(v) && Math.abs(v) >= 10000) return v.toLocaleString();
    }
    return null;
  }

  /* ---------------- row links (#ll= hash) ---------------- */

  // Inverse of pathToString: '$.rooms[0]["odd key"].id' -> ['rooms', 0, 'odd key', 'id']
  function parsePath(str) {
    if (typeof str !== 'string' || str[0] !== '$') return null;
    const out = [];
    let i = 1;
    while (i < str.length) {
      if (str[i] === '.') {
        const m = /^[A-Za-z_$][A-Za-z0-9_$-]*/.exec(str.slice(i + 1));
        if (!m) return null;
        out.push(m[0]);
        i += 1 + m[0].length;
      } else if (str[i] === '[') {
        if (str[i + 1] === '"') {
          let j = i + 2, key = '';
          while (j < str.length && str[j] !== '"') {
            if (str[j] === '\\' && str[j + 1] === '"') { key += '"'; j += 2; continue; }
            key += str[j]; j++;
          }
          if (str[j] !== '"' || str[j + 1] !== ']') return null;
          out.push(key);
          i = j + 2;
        } else {
          const m = /^\d+/.exec(str.slice(i + 1));
          if (!m || str[i + 1 + m[0].length] !== ']') return null;
          out.push(Number(m[0]));
          i += 2 + m[0].length;
        }
      } else return null;
    }
    return out;
  }

  /* ---------------- copy as table ---------------- */

  // One item -> flat {column: cell}: scalars as-is, nested scalars as dot
  // columns (depth 2), anything deeper/array -> its summarize() preview.
  function flattenItem(item) {
    const out = {};
    for (const [k, v] of Object.entries(item)) {
      if (!isObj(v)) { out[k] = v; continue; }
      if (Array.isArray(v)) { out[k] = summarize(v); continue; }
      const entries = Object.entries(v);
      if (!entries.length) { out[k] = summarize(v); continue; }
      for (const [k2, v2] of entries) out[k + '.' + k2] = isObj(v2) ? summarize(v2) : v2;
    }
    return out;
  }

  function arrayToTsv(items) {
    const flats = items.map(flattenItem);
    const cols = [];
    for (const f of flats) for (const k of Object.keys(f)) { if (!cols.includes(k)) cols.push(k); }
    const cell = (v) => (v === undefined ? '' : String(v).replace(/[\t\n\r]+/g, ' '));
    const lines = [cols.join('\t')];
    for (const f of flats) lines.push(cols.map((c) => cell(f[c])).join('\t'));
    return lines.join('\n');
  }

  /* ---------------- tree ---------------- */

  class Tree {
    constructor(container, value) {
      this.value = value;
      this.root = el('div', 'll-tree');
      this.rootNode = this.renderNode('$', value, []);
      this.root.appendChild(this.rootNode);
      container.appendChild(this.root);
    }

    renderNode(key, value, path) {
      const node = el('div', 'll-node');
      const row = el('div', 'll-row');
      node.appendChild(row);

      const parsed = tryParseJsonString(value);
      const eff = parsed || value;
      const expandable = isObj(eff);
      node.__ll = { key, value, path, child: expandable ? eff : undefined };

      const tg = el('span', 'll-toggle', expandable ? '▸' : ' ');
      row.appendChild(tg);

      const keySpan = el('span', 'll-key' + (typeof key === 'number' ? ' ll-idx' : ''), String(key));
      row.appendChild(keySpan);
      row.appendChild(el('span', 'll-colon', ': '));

      if (expandable) {
        if (parsed) {
          const badge = el('span', 'll-badge', 'str→json');
          badge.title = 'This string contains JSON — parsed for you. "copy" copies the original string.';
          row.appendChild(badge);
        }
        const prev = el('span', 'll-preview', summarize(eff));
        row.appendChild(prev);
        const kids = el('div', 'll-children');
        kids.hidden = true;
        node.appendChild(kids);
        const toggle = () => this.setExpanded(node, kids.hidden);
        onPlainClick(tg, toggle);
        onPlainClick(prev, toggle);
        onPlainClick(keySpan, toggle);
      } else {
        row.appendChild(this.renderScalar(value));
      }

      const tools = el('span', 'll-tools');
      const bVal = el('button', 'll-btn', expandable ? 'copy JSON' : 'copy');
      bVal.title = expandable
        ? 'Copy this whole object/array as pretty-printed JSON'
        : 'Copy this value';
      bVal.addEventListener('click', (e) => {
        e.stopPropagation();
        let text;
        if (isObj(value)) text = JSON.stringify(value, null, 2);
        else if (typeof value === 'string') text = value;
        else text = String(value);
        copyText(text, bVal);
      });
      tools.appendChild(bVal);
      if (parsed) {
        const bParsed = el('button', 'll-btn', 'copy parsed');
        bParsed.title = 'Copy the parsed JSON (pretty-printed)';
        bParsed.addEventListener('click', (e) => {
          e.stopPropagation();
          copyText(JSON.stringify(parsed, null, 2), bParsed);
        });
        tools.appendChild(bParsed);
      }
      const bPath = el('button', 'll-btn', 'path');
      bPath.title = 'Copy path';
      bPath.addEventListener('click', (e) => {
        e.stopPropagation();
        copyText(pathToString(path), bPath);
      });
      tools.appendChild(bPath);
      // an array of similar objects can leave as a paste-ready TSV table
      if (Array.isArray(eff) && eff.length >= 2 && eff.every((x) => isObj(x) && !Array.isArray(x))) {
        const bTable = el('button', 'll-btn', 'copy table');
        bTable.title = 'Copy these ' + eff.length + ' items as a TSV table (paste into Jira/Sheets)';
        bTable.addEventListener('click', (e) => {
          e.stopPropagation();
          copyText(arrayToTsv(eff), bTable);
        });
        tools.appendChild(bTable);
      }
      const bPin = el('button', 'll-btn', 'pin');
      bPin.title = 'Pin/unpin this key in the watch strip at the top';
      bPin.addEventListener('click', (e) => {
        e.stopPropagation();
        togglePin(String(key));
        const old = bPin.textContent;
        bPin.textContent = '✓';
        setTimeout(() => { bPin.textContent = old; }, 700);
      });
      tools.appendChild(bPin);
      const bLink = el('button', 'll-btn', '🔗');
      bLink.title = 'Copy a link that opens this page and jumps to this row';
      bLink.addEventListener('click', (e) => {
        e.stopPropagation();
        copyText(location.href.split('#')[0] + '#ll=' + encodeURIComponent(pathToString(path)), bLink);
      });
      tools.appendChild(bLink);
      row.appendChild(tools);

      return node;
    }

    renderScalar(v) {
      const t = typeOf(v);
      const span = el('span', 'll-val ll-' + t);
      const tip = valueTooltip(v);
      if (tip) span.title = tip;
      if (t === 'string') {
        if (v.length > TRUNC) {
          span.textContent = JSON.stringify(v.slice(0, TRUNC)).slice(0, -1) + '…" (' + v.length + ' chars — click to expand)';
          span.classList.add('ll-trunc');
          span.addEventListener('click', function onClick() {
            span.textContent = JSON.stringify(v);
            span.classList.remove('ll-trunc');
            span.removeEventListener('click', onClick);
          });
        } else {
          span.textContent = JSON.stringify(v);
        }
      } else {
        span.textContent = String(v);
      }
      return span;
    }

    setExpanded(node, expand) {
      const kids = node.querySelector(':scope > .ll-children');
      if (!kids) return;
      const tg = node.querySelector(':scope > .ll-row > .ll-toggle');
      const prev = node.querySelector(':scope > .ll-row > .ll-preview');
      if (expand) {
        if (!kids.__filled) this.fillChildren(node, kids);
        kids.hidden = false;
        tg.textContent = '▼';
        if (prev) prev.hidden = true;
      } else {
        kids.hidden = true;
        tg.textContent = '▸';
        if (prev) prev.hidden = false;
      }
    }

    fillChildren(node, kids) {
      kids.__filled = true;
      const v = node.__ll.child;
      const entries = Array.isArray(v) ? v.map((x, i) => [i, x]) : Object.entries(v);
      this.appendChunk(kids, entries, 0, node.__ll.path);
    }

    appendChunk(kids, entries, start, path) {
      const end = Math.min(entries.length, start + CHUNK);
      const frag = document.createDocumentFragment();
      for (let i = start; i < end; i++) {
        frag.appendChild(this.renderNode(entries[i][0], entries[i][1], path.concat([entries[i][0]])));
      }
      kids.appendChild(frag);
      if (end < entries.length) {
        const more = el('button', 'll-more',
          'show ' + Math.min(CHUNK, entries.length - end) + ' more (' + (entries.length - end) + ' hidden)');
        more.addEventListener('click', () => {
          more.remove();
          this.appendChunk(kids, entries, end, path);
        });
        kids.appendChild(more);
      }
    }

    /* ----- bulk expand / collapse ----- */

    // Where a bulk expand/collapse starts. While the matches-only filter is on
    // the rest of the document is hidden, so spending the budget out there
    // meant "all" never reached the matches the user was looking at.
    bulkRoots() {
      if (!this.root.classList.contains('ll-filtering')) return [this.rootNode];
      const hits = Array.from(this.root.querySelectorAll('.ll-keep-hit'));
      // a hit nested inside another hit is already covered by it
      return hits.filter((n) => !(n.parentElement && n.parentElement.closest('.ll-keep-hit')));
    }

    expandToDepth(depth, roots) {
      let budget = EXPAND_BUDGET;
      const rec = (node, d) => {
        if (!node.__ll || node.__ll.child === undefined) return; // leaf: free
        if (budget-- <= 0) return;
        this.setExpanded(node, true);
        if (d <= 1) return;
        const kids = node.querySelector(':scope > .ll-children');
        if (!kids) return;
        for (const c of kids.children) rec(c, d - 1);
      };
      for (const r of (roots || this.bulkRoots())) rec(r, depth);
      return budget > 0;
    }

    setDepth(depth) {
      const roots = this.bulkRoots();
      if (this.root.classList.contains('ll-filtering')) {
        // collapsing everything would close the ancestor chain that keeps the
        // matches on screen — stay inside each match instead
        for (const r of roots) this.collapseWithin(r);
      } else {
        this.collapseAll();
      }
      return this.expandToDepth(depth, roots);
    }

    // The budget counts containers actually expanded, not nodes visited: a
    // wide array of scalars used to eat the whole cap on its leaves.
    expandAll(roots) {
      let budget = EXPAND_BUDGET;
      const stack = (roots || this.bulkRoots()).slice();
      while (stack.length) {
        const node = stack.pop();
        if (!node.__ll || node.__ll.child === undefined) continue;
        if (budget-- <= 0) return false;
        this.setExpanded(node, true);
        const kids = node.querySelector(':scope > .ll-children');
        if (!kids) continue;
        for (const c of kids.children) if (c.__ll) stack.push(c);
      }
      return true;
    }

    collapseWithin(el) {
      el.querySelectorAll('.ll-children').forEach((k) => {
        if (!k.hidden) this.setExpanded(k.parentElement, false);
      });
    }

    collapseAll() {
      this.collapseWithin(this.root);
    }

    /* ----- pinned-key lookup (walks the DATA, like search) ----- */

    findKey(key) {
      const matches = [];
      const walk = (k, value, path) => {
        if (matches.length >= MAX_MATCHES) return;
        if (String(k) === key) matches.push({ path });
        const parsed = tryParseJsonString(value);
        const eff = parsed || value;
        if (isObj(eff)) {
          const entries = Array.isArray(eff) ? eff.map((x, i) => [i, x]) : Object.entries(eff);
          for (const [k2, v2] of entries) {
            if (matches.length >= MAX_MATCHES) return;
            walk(k2, v2, path.concat([k2]));
          }
        }
      };
      const rootParsed = tryParseJsonString(this.value);
      const eff = rootParsed || this.value;
      if (isObj(eff)) {
        const entries = Array.isArray(eff) ? eff.map((x, i) => [i, x]) : Object.entries(eff);
        for (const [k, v] of entries) walk(k, v, [k]);
      }
      return matches;
    }

    valueAt(path) {
      let v = this.value;
      for (const k of path) {
        const parsed = tryParseJsonString(v);
        v = parsed || v;
        if (!isObj(v)) return undefined;
        v = v[k];
      }
      return v;
    }

    /* ----- search ----- */

    // Walks the data (not the DOM), so it finds matches inside nodes
    // that have never been rendered, including inside parsed JSON-strings.
    search(query) {
      const q = query.toLowerCase();
      const matches = [];
      const walk = (key, value, path) => {
        if (matches.length >= MAX_MATCHES) return;
        if (String(key).toLowerCase().includes(q)) matches.push({ path, where: 'key' });
        const parsed = tryParseJsonString(value);
        const eff = parsed || value;
        if (isObj(eff)) {
          const entries = Array.isArray(eff) ? eff.map((x, i) => [i, x]) : Object.entries(eff);
          for (const [k, v2] of entries) {
            if (matches.length >= MAX_MATCHES) return;
            walk(k, v2, path.concat([k]));
          }
        } else if (String(eff).toLowerCase().includes(q)) {
          matches.push({ path, where: 'value' });
        }
      };
      const rootParsed = tryParseJsonString(this.value);
      const eff = rootParsed || this.value;
      if (isObj(eff)) {
        const entries = Array.isArray(eff) ? eff.map((x, i) => [i, x]) : Object.entries(eff);
        for (const [k, v2] of entries) walk(k, v2, [k]);
      } else {
        walk('$', this.value, []);
      }
      return matches;
    }

    // Expands the tree down to `path` (rendering chunks as needed); returns the node element.
    ensureRendered(path) {
      let node = this.rootNode;
      for (const k of path) {
        this.setExpanded(node, true);
        const kids = node.querySelector(':scope > .ll-children');
        if (!kids) return node;
        let found = this.findChild(kids, k);
        while (!found) {
          const more = kids.querySelector(':scope > .ll-more');
          if (!more) break;
          more.click();
          found = this.findChild(kids, k);
        }
        if (!found) return node;
        node = found;
      }
      return node;
    }

    findChild(kids, k) {
      const ks = String(k);
      for (const c of kids.children) {
        if (c.__ll && String(c.__ll.key) === ks) return c;
      }
      return null;
    }

    /* ----- filter (matches-only view) ----- */

    applyFilter(matches, on) {
      this.root.classList.toggle('ll-filtering', on);
      this.root.querySelectorAll('.ll-keep-anc, .ll-keep-hit')
        .forEach((e) => e.classList.remove('ll-keep-anc', 'll-keep-hit'));
      if (!on) return;
      for (let i = 0; i < matches.length; i++) {
        const nodeEl = this.ensureRendered(matches[i].path);
        if (nodeEl.parentElement && nodeEl.parentElement.closest('.ll-keep-hit')) continue; // shown by CSS already
        nodeEl.classList.add('ll-keep-hit');
        let p = nodeEl.parentElement;
        while (p && p !== this.root) {
          if (p.classList && p.classList.contains('ll-node')) p.classList.add('ll-keep-anc');
          p = p.parentElement;
        }
      }
    }
  }

  /* ---------------- text segmentation ---------------- */
  // Splits mixed text (headers/preamble + one or more JSON blobs) into segments.

  function scanBalanced(text, start) {
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < text.length; i++) {
      const c = text[i];
      if (inStr) {
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') inStr = false;
      } else {
        if (c === '"') inStr = true;
        else if (c === '{' || c === '[') depth++;
        else if (c === '}' || c === ']') {
          depth--;
          if (depth === 0) return i;
          if (depth < 0) return -1;
        }
      }
    }
    return -1;
  }

  function extractSegments(text) {
    if (text.length > 30_000_000) text = text.slice(0, 30_000_000);
    const trimmed = text.trim();
    // fast path: the whole thing is one JSON document
    if (trimmed[0] === '{' || trimmed[0] === '[') {
      try {
        const v = JSON.parse(trimmed);
        if (isObj(v)) return [{ type: 'json', value: v, raw: trimmed }];
      } catch (e) { /* fall through to segment scan */ }
    }
    const segments = [];
    let i = 0, lastText = 0;
    while (i < text.length) {
      const c = text[i];
      if (c === '{' || c === '[') {
        const end = scanBalanced(text, i);
        // arrays need >=10 chars so preamble noise like [542] stays text;
        // objects only need to be a plausible {"k":v}
        if (end > i && (end - i >= 10 || (c === '{' && end - i >= 4))) {
          const cand = text.slice(i, end + 1);
          try {
            const v = JSON.parse(cand);
            if (isObj(v)) {
              const before = text.slice(lastText, i);
              if (before.trim()) segments.push({ type: 'text', text: before.replace(/\s+$/, '') });
              segments.push({ type: 'json', value: v, raw: cand });
              lastText = end + 1;
              i = end + 1;
              continue;
            }
          } catch (e) { /* not JSON, keep scanning */ }
          i = end + 1; // balanced but not JSON: skip past it instead of rescanning inside
          continue;
        }
      }
      i++;
    }
    if (lastText < text.length) {
      const rest = text.slice(lastText);
      if (rest.trim()) segments.push({ type: 'text', text: rest });
    }
    return segments;
  }

  /* ---------------- mounted viewer (toolbar + trees) ---------------- */

  function mount(container, input, opts = {}) {
    const rootEl = el('div', 'll-root' + (opts.full ? ' ll-full' : ''));
    const bar = el('div', 'll-bar');
    const body = el('div', 'll-body');
    const treePane = el('div', 'll-treepane');
    const rawPre = el('pre', 'll-raw');
    rawPre.hidden = true;
    rawPre.textContent = input.rawText || '';

    const trees = [];
    for (const seg of input.segments) {
      if (seg.type === 'text') {
        treePane.appendChild(el('pre', 'll-textseg', seg.text));
      } else {
        const holder = el('div', 'll-seg');
        treePane.appendChild(holder);
        trees.push(new Tree(holder, seg.value));
      }
    }
    trees.forEach((t) => t.expandToDepth(2));

    /* toolbar */
    const brand = el('span', 'll-brand');
    brand.appendChild(el('span', 'll-brand-icon', '⌕'));
    brand.appendChild(el('span', 'll-brand-name', 'Log Lens'));

    const tbtn = (label, title, cls) => {
      const b = el('button', 'll-btn2' + (cls ? ' ' + cls : ''), label);
      b.title = title;
      return b;
    };

    // search pill absorbs the match counter and prev/next
    const searchWrap = el('span', 'll-searchwrap');
    const searchIn = el('input', 'll-search');
    searchIn.type = 'search';
    searchIn.placeholder = 'search keys & values…';
    const count = el('span', 'll-count', '');
    const bPrev = tbtn('‹', 'Previous match (Shift+Enter)', 'll-nav');
    const bNext = tbtn('›', 'Next match (Enter)', 'll-nav');
    searchWrap.appendChild(el('span', 'll-searchicon', '⌕'));
    searchWrap.appendChild(searchIn);
    searchWrap.appendChild(count);
    searchWrap.appendChild(bPrev);
    searchWrap.appendChild(bNext);

    const filterLbl = el('label', 'll-filterlbl');
    const filterCb = document.createElement('input');
    filterCb.type = 'checkbox';
    filterLbl.appendChild(filterCb);
    filterLbl.appendChild(document.createTextNode(' matches only'));

    const group = el('span', 'll-group');
    const b1 = tbtn('1', 'Expand to depth 1');
    const b2 = tbtn('2', 'Expand to depth 2');
    const b3 = tbtn('3', 'Expand to depth 3');
    const bAll = tbtn('all', 'Expand everything (capped on huge payloads)');
    const bCol = tbtn('−', 'Collapse all');
    [b1, b2, b3, bAll, bCol].forEach((x) => group.appendChild(x));

    const bCopy = tbtn('copy JSON', 'Copy the full JSON (pretty-printed)');
    const bRaw = tbtn('raw', 'Toggle original raw text');

    const items = [brand, searchWrap, filterLbl, group, el('span', 'll-spacer'), bCopy, bRaw];
    if (opts.onPowerOff) {
      const bOff = tbtn('off', 'Switch this site back to the original log view (re-enable via the floating pill or the toolbar popup)', 'll-power');
      bOff.addEventListener('click', () => opts.onPowerOff());
      items.push(bOff);
    }
    items.forEach((x) => bar.appendChild(x));

    /* pin strip — the pinned keys' values, always visible above the tree */
    initPins();
    const strip = el('div', 'll-pinstrip');
    strip.hidden = true;

    function jumpTo(tree, path) {
      const node = tree.ensureRendered(path);
      rootEl.querySelectorAll('.ll-current-hit').forEach((x) => x.classList.remove('ll-current-hit'));
      const target = node.querySelector(':scope > .ll-row > .ll-key');
      if (target) {
        target.classList.add('ll-hit', 'll-current-hit');
        target.scrollIntoView({ block: 'center' });
      }
    }

    function pinPreview(v) {
      if (v === undefined) return '';
      if (isObj(v)) return summarize(v);
      if (typeof v === 'string') return JSON.stringify(v.length > 40 ? v.slice(0, 40) + '…' : v);
      return String(v);
    }

    const chipIdx = {}; // key -> last-visited occurrence
    function renderStrip() {
      const keys = pins.keys;
      strip.textContent = '';
      strip.hidden = !keys.length || !rawPre.hidden; // hidden while raw view is up
      for (const key of keys) {
        const occ = [];
        for (const t of trees) for (const m of t.findKey(key)) occ.push({ tree: t, path: m.path });
        const chip = el('span', 'll-pin' + (occ.length ? '' : ' ll-pin-empty'));
        chip.appendChild(el('span', 'll-pin-key', key));
        if (!occ.length) {
          chip.appendChild(el('span', 'll-pin-val', '—'));
          chip.title = '"' + key + '" does not occur in this log';
        } else {
          const capped = occ.length >= MAX_MATCHES ? '+' : '';
          const cnt = el('span', 'll-pin-count', occ.length + capped + '✕');
          chip.appendChild(cnt);
          const val = el('span', 'll-pin-val', pinPreview(occ[0].tree.valueAt(occ[0].path)));
          chip.appendChild(val);
          chip.title = 'Click to jump between the ' + occ.length + capped + ' occurrences of "' + key + '" — ‹ › step back and forward';
          // one stepper for body-click (+1), ‹ (−1) and › (+1); the chip shows
          // the CURRENT occurrence's value while stepping, not the first one
          const step = (delta) => {
            const n = occ.length;
            const cur = chipIdx[key] === undefined ? (delta > 0 ? -1 : 0) : chipIdx[key];
            chipIdx[key] = ((cur + delta) % n + n) % n;
            const o = occ[chipIdx[key]];
            cnt.textContent = (chipIdx[key] + 1) + '/' + n + capped;
            val.textContent = pinPreview(o.tree.valueAt(o.path));
            jumpTo(o.tree, o.path);
          };
          chip.addEventListener('click', (e) => {
            if (e.target.classList && (e.target.classList.contains('ll-pin-x') || e.target.classList.contains('ll-pin-nav'))) return;
            step(1);
          });
          const prev = el('button', 'll-pin-nav', '‹');
          prev.title = 'Previous occurrence';
          prev.addEventListener('click', (e) => { e.stopPropagation(); step(-1); });
          const next = el('button', 'll-pin-nav', '›');
          next.title = 'Next occurrence';
          next.addEventListener('click', (e) => { e.stopPropagation(); step(1); });
          chip.appendChild(prev);
          chip.appendChild(next);
        }
        const x = el('button', 'll-pin-x', '✕');
        x.title = 'Unpin "' + key + '"';
        x.addEventListener('click', (e) => { e.stopPropagation(); togglePin(key); });
        chip.appendChild(x);
        strip.appendChild(chip);
      }
    }
    pins.listeners.push(renderStrip);
    renderStrip();

    body.appendChild(treePane);
    // bar + strip stick together as one header while the tree scrolls
    const head = el('div', 'll-head');
    head.appendChild(bar);
    head.appendChild(strip);
    rootEl.appendChild(head);
    rootEl.appendChild(body);
    rootEl.appendChild(rawPre);
    container.appendChild(rootEl);

    /* a #ll=<path> hash (from the 🔗 row action) jumps straight to that row */
    if (!window.__llHashDone) {
      const hm = /^#ll=(.+)$/.exec(location.hash || '');
      if (hm) {
        let pstr = null;
        try { pstr = decodeURIComponent(hm[1]); } catch (e) { /* malformed — ignore */ }
        const hpath = pstr && parsePath(pstr);
        if (hpath) {
          for (const t of trees) {
            const node = t.ensureRendered(hpath);
            if (node && node.__ll && pathToString(node.__ll.path) === pstr) {
              window.__llHashDone = true;
              jumpTo(t, hpath);
              break;
            }
          }
        }
      }
    }

    /* smart copy — a selection spanning several rows copies real JSON of the
       smallest object/array containing it, taken from the parsed data, so
       collapsed children are included too. A selection inside a single row
       keeps native plain-text copy (grab one token/id as usual). */
    rootEl.addEventListener('copy', (e) => {
      const selection = window.getSelection && window.getSelection();
      if (!selection || selection.isCollapsed || !selection.rangeCount) return;
      const range = selection.getRangeAt(0);
      const rowOf = (n) => {
        const elm = n && n.nodeType === 3 ? n.parentElement : n;
        return elm && elm.closest ? elm.closest('.ll-row') : null;
      };
      const startRow = rowOf(range.startContainer);
      const endRow = rowOf(range.endContainer);
      if (startRow && startRow === endRow) return; // within one row → plain text
      let anc = range.commonAncestorContainer;
      if (anc && anc.nodeType === 3) anc = anc.parentElement;
      let nodeEl = anc && anc.closest ? anc.closest('.ll-node') : null;
      while (nodeEl && !nodeEl.__ll) nodeEl = nodeEl.parentElement && nodeEl.parentElement.closest('.ll-node');
      if (!nodeEl || !nodeEl.__ll) return;
      const raw = nodeEl.__ll.value;
      const eff = tryParseJsonString(raw) || raw;
      if (!isObj(eff)) return; // scalar → nothing better than the native text
      try {
        e.clipboardData.setData('text/plain', JSON.stringify(eff, null, 2));
        e.preventDefault();
      } catch (err) { /* clipboard unavailable — fall back to native copy */ }
    });

    /* search state */
    const state = { matches: [], idx: -1, capped: false };
    let marked = [];

    function clearHits() {
      marked.forEach((s) => s.classList.remove('ll-hit', 'll-current-hit'));
      marked = [];
    }

    function goTo(i) {
      if (!state.matches.length) return;
      state.idx = ((i % state.matches.length) + state.matches.length) % state.matches.length;
      const m = state.matches[state.idx];
      const node = m.tree.ensureRendered(m.path);
      const row = node.querySelector(':scope > .ll-row');
      const target = (m.where === 'key')
        ? row.querySelector('.ll-key')
        : (row.querySelector('.ll-val') || row.querySelector('.ll-key'));
      rootEl.querySelectorAll('.ll-current-hit').forEach((s) => s.classList.remove('ll-current-hit'));
      target.classList.add('ll-hit', 'll-current-hit');
      marked.push(target);
      target.scrollIntoView({ block: 'center' });
      restoreCount();
    }

    // The one place that renders .ll-count, so a transient message (an expand
    // cap) can always hand the real search state back.
    function restoreCount() {
      if (state.matches.length) {
        const total = state.matches.length + (state.capped ? '+' : '');
        count.textContent = state.idx >= 0 ? (state.idx + 1) + ' / ' + total : total;
      } else {
        count.textContent = searchIn.value.trim() ? '0' : '';
      }
    }

    let flashT = null;
    function flash(msg) {
      count.textContent = msg;
      clearTimeout(flashT);
      flashT = setTimeout(restoreCount, 2500);
    }

    function applyFilterAll(on) {
      for (const t of trees) {
        t.applyFilter(state.matches.filter((m) => m.tree === t), on);
      }
    }

    function runSearch() {
      const q = searchIn.value.trim();
      clearHits();
      state.matches = [];
      state.idx = -1;
      applyFilterAll(false);
      if (!q) { restoreCount(); return; }
      for (const t of trees) {
        for (const m of t.search(q)) state.matches.push({ tree: t, path: m.path, where: m.where });
        if (state.matches.length >= MAX_MATCHES) break;
      }
      state.capped = state.matches.length >= MAX_MATCHES;
      if (!state.matches.length) { restoreCount(); return; }
      if (filterCb.checked) applyFilterAll(true);
      goTo(0);
    }

    let deb = null;
    searchIn.addEventListener('input', () => {
      clearTimeout(deb);
      deb = setTimeout(runSearch, 250);
    });
    searchIn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        goTo(state.idx + (e.shiftKey ? -1 : 1));
      }
    });
    bNext.addEventListener('click', () => goTo(state.idx + 1));
    bPrev.addEventListener('click', () => goTo(state.idx - 1));
    filterCb.addEventListener('change', () => {
      if (state.matches.length) applyFilterAll(filterCb.checked);
    });

    function bulkDepth(d) {
      const ok = trees.map((t) => t.setDepth(d)).every(Boolean);
      if (!ok) flash('expanded first ' + EXPAND_BUDGET + ' nodes');
    }
    b1.addEventListener('click', () => bulkDepth(1));
    b2.addEventListener('click', () => bulkDepth(2));
    b3.addEventListener('click', () => bulkDepth(3));
    bAll.addEventListener('click', () => {
      const ok = trees.map((t) => t.expandAll()).every(Boolean);
      if (!ok) flash('expanded first ' + EXPAND_BUDGET + ' nodes');
    });
    bCol.addEventListener('click', () => trees.forEach((t) => {
      if (t.root.classList.contains('ll-filtering')) {
        // keep the matches on screen — collapse only what is inside them
        for (const r of t.bulkRoots()) t.collapseWithin(r);
      } else {
        t.collapseAll();
        t.setExpanded(t.rootNode, true);
      }
    }));

    bCopy.addEventListener('click', () => {
      const jsonSegs = input.segments.filter((s) => s.type === 'json');
      const text = (jsonSegs.length === 1)
        ? JSON.stringify(jsonSegs[0].value, null, 2)
        : (input.rawText || jsonSegs.map((s) => JSON.stringify(s.value, null, 2)).join('\n\n'));
      copyText(text, bCopy);
    });
    bRaw.addEventListener('click', () => {
      const showRaw = rawPre.hidden;
      rawPre.hidden = !showRaw;
      body.hidden = showRaw;
      strip.hidden = showRaw || !pins.keys.length;
      bRaw.classList.toggle('ll-active', showRaw);
    });

    return {
      root: rootEl,
      trees,
      // for callers that re-mount into the same page repeatedly (the DevTools
      // panel): detach this viewer's pin-strip listener so it can be GC'd
      dispose() {
        const i = pins.listeners.indexOf(renderStrip);
        if (i >= 0) pins.listeners.splice(i, 1);
        rootEl.remove();
      },
    };
  }

  /* ---------------- theme ---------------- */
  // Applies user colors from the options page. Values are validated
  // (#hex colors, bounded px size) so stored data can't inject CSS.
  const THEME_VARS = {
    accent: '--ll-accent',
    text: '--ll-fg',
    bg: '--ll-bg',
    barBg: '--ll-bar-bg',
    key: '--ll-key',
    string: '--ll-string',
    number: '--ll-number',
    boolean: '--ll-boolean',
  };

  function applyTheme(theme) {
    let css = ':root {';
    if (theme && typeof theme === 'object') {
      for (const [k, v] of Object.entries(theme)) {
        if (k === 'fontSize') {
          const n = parseInt(v, 10);
          if (n >= 9 && n <= 20) css += '--ll-font-size:' + n + 'px;';
        } else if (THEME_VARS[k] && typeof v === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(v)) {
          css += THEME_VARS[k] + ':' + v + ';';
        }
      }
    }
    css += '}';
    let st = document.getElementById('ll-theme');
    if (!st) {
      st = document.createElement('style');
      st.id = 'll-theme';
      (document.head || document.documentElement).appendChild(st);
    }
    st.textContent = css;
  }

  window.LogLens = { mount, extractSegments, Tree, applyTheme, setPins: setPinnedKeys };
})();
