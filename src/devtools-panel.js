/* Log Lens — DevTools panel.
 * A request list fed by chrome.devtools.network; selecting a request renders
 * its response body (or request payload) through the same LogLens.mount the
 * web view and paste viewer use. Chrome offers no API to modify the built-in
 * Network Response tab, so this panel is the supported way in.
 *
 * Outside a real DevTools context (tests, direct open) chrome.devtools is
 * undefined: the panel shows a hint and exposes window.__llPanel.feed/select
 * so the smoke suite can drive it with fake entries.
 */
(function () {
  'use strict';
  const LL = window.LogLens;
  const MAX_TREE_BYTES = 8 * 1024 * 1024; // above this: raw view only

  const listEl = document.getElementById('list');
  const viewEl = document.getElementById('view');
  const filterIn = document.getElementById('filter');
  const jsonOnly = document.getElementById('jsononly');
  const preserve = document.getElementById('preserve');
  const clearBtn = document.getElementById('clear');
  const countEl = document.getElementById('count');
  const tabResp = document.getElementById('tab-resp');
  const tabPayload = document.getElementById('tab-payload');

  let entries = [];      // { url, name, method, status, mime, resourceType, entry }
  let selected = -1;     // index into entries
  let tab = 'resp';
  let mounted = null;    // current LL.mount result, disposed before re-mount

  function looksJson(e) {
    const m = (e.mime || '').toLowerCase();
    const rt = (e.resourceType || '').toLowerCase();
    return m.includes('json') || rt === 'xhr' || rt === 'fetch';
  }

  function visible() {
    const q = filterIn.value.trim().toLowerCase();
    return entries.filter((e) =>
      (!jsonOnly.checked || looksJson(e)) &&
      (!q || e.url.toLowerCase().includes(q)));
  }

  function renderList() {
    const vis = visible();
    listEl.textContent = '';
    for (const e of vis) {
      const div = document.createElement('div');
      div.className = 'req' + (entries.indexOf(e) === selected ? ' sel' : '');
      const name = document.createElement('div');
      name.className = 'name';
      name.textContent = e.name;
      const meta = document.createElement('div');
      meta.className = 'meta';
      meta.textContent = e.method + ' · ';
      const st = document.createElement('span');
      st.textContent = e.status;
      if (e.status >= 400) st.className = 'err';
      meta.appendChild(st);
      if (e.mime) meta.appendChild(document.createTextNode(' · ' + e.mime));
      div.appendChild(name);
      div.appendChild(meta);
      div.addEventListener('click', () => select(entries.indexOf(e)));
      listEl.appendChild(div);
    }
    countEl.textContent = vis.length + ' / ' + entries.length + ' requests';
  }

  function showMsg(text) {
    if (mounted) { mounted.dispose(); mounted = null; }
    viewEl.textContent = '';
    const d = document.createElement('div');
    d.className = 'msg';
    d.textContent = text;
    viewEl.appendChild(d);
  }

  function showRaw(text) {
    if (mounted) { mounted.dispose(); mounted = null; }
    viewEl.textContent = '';
    const pre = document.createElement('pre');
    pre.className = 'rawbody';
    pre.textContent = text;
    viewEl.appendChild(pre);
  }

  function showTree(text) {
    let segs = [];
    try { segs = LL.extractSegments(text); } catch (err) { /* fall through to raw */ }
    if (!segs.some((s) => s.type === 'json')) { showRaw(text); return; }
    if (mounted) { mounted.dispose(); mounted = null; }
    viewEl.textContent = '';
    mounted = LL.mount(viewEl, { segments: segs, rawText: text });
  }

  function renderView() {
    const e = entries[selected];
    if (!e) { showMsg('Click a request on the left.'); return; }
    if (tab === 'payload') {
      const post = e.entry.request && e.entry.request.postData && e.entry.request.postData.text;
      if (post) { showTree(post); return; }
      const qs = (e.entry.request && e.entry.request.queryString) || [];
      if (qs.length) {
        const obj = {};
        for (const p of qs) obj[p.name] = p.value;
        showTree(JSON.stringify(obj));
        return;
      }
      showMsg('This request has no payload.');
      return;
    }
    // response tab: bodies are fetched lazily, only for the selected request
    e.entry.getContent((body, encoding) => {
      if (entries[selected] !== e || tab !== 'resp') return; // stale callback
      if (body == null || body === '') { showMsg('No response body (or DevTools was opened after the request — reload the page).'); return; }
      if (encoding === 'base64') {
        try { body = atob(body); } catch (err) { showMsg('Binary response body.'); return; }
      }
      if (body.length > MAX_TREE_BYTES) { showRaw(body.slice(0, MAX_TREE_BYTES)); return; }
      showTree(body);
    });
  }

  function select(i) {
    selected = i;
    renderList();
    renderView();
  }

  function setTab(t) {
    tab = t;
    tabResp.classList.toggle('on', t === 'resp');
    tabPayload.classList.toggle('on', t === 'payload');
    renderView();
  }
  tabResp.addEventListener('click', () => setTab('resp'));
  tabPayload.addEventListener('click', () => setTab('payload'));

  function addEntry(entry) {
    const req = entry.request || {};
    const res = entry.response || {};
    let name;
    try {
      const u = new URL(req.url);
      name = (u.pathname.split('/').filter(Boolean).pop() || u.hostname) + u.search.slice(0, 60);
    } catch (err) { name = String(req.url || '').slice(0, 80); }
    entries.push({
      url: req.url || '',
      name,
      method: req.method || 'GET',
      status: res.status || 0,
      mime: (res.content && res.content.mimeType) || '',
      resourceType: entry._resourceType || '',
      entry,
    });
    renderList();
  }

  function clearAll() {
    entries = [];
    selected = -1;
    renderList();
    showMsg('Requests will appear on the left as the inspected page makes them.');
  }

  filterIn.addEventListener('input', renderList);
  jsonOnly.addEventListener('change', renderList);
  clearBtn.addEventListener('click', clearAll);

  /* ---- data source: real DevTools, or the test hook ---- */

  if (typeof chrome !== 'undefined' && chrome.devtools && chrome.devtools.network) {
    chrome.devtools.network.onRequestFinished.addListener(addEntry);
    chrome.devtools.network.onNavigated.addListener(() => {
      if (!preserve.checked) clearAll();
    });
  } else {
    showMsg('Open DevTools (F12) on a page — this panel lives there as the "⌕ Log Lens" tab.');
    window.__llPanel = {
      feed(list) { list.forEach(addEntry); },
      select,
      setTab,
    };
  }

  /* user theme, exactly like the paste viewer */
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
    try {
      chrome.storage.sync.get('theme').then((r) => {
        if (r && r.theme) LL.applyTheme(r.theme);
      }).catch(() => {});
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'sync' && changes.theme) LL.applyTheme(changes.theme.newValue || {});
      });
    } catch (err) { /* theme stays default */ }
  }

  renderList();
})();
