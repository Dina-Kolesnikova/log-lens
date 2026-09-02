const listEl = document.getElementById('list');
const input = document.getElementById('pattern');
const errEl = document.getElementById('err');
const grantEl = document.getElementById('grantinfo');
const everyEl = document.getElementById('everysite');

const P = window.LLPatterns;
const ALL_SITES = '*://*/*';

// cached so a click handler can act without awaiting storage first —
// chrome.permissions.request() only works inside the user gesture
let sites = [];

function setErr(msg) { errEl.textContent = msg || ''; }

/* Live preview: exactly what Chrome will be asked for, before it asks.
 * A pattern with a mid-host wildcard cannot be granted as typed, so the grant
 * is a wider superset and the pattern itself becomes a local filter. */
function describeGrant(raw) {
  const p = P.normalizeInput(raw);
  grantEl.className = '';
  if (!p || !P.parse(p)) { grantEl.textContent = ''; return; }
  const origin = P.toGrantOrigin(p);
  const broad = P.grantIsTldWide(p);
  const parts = ['Chrome will be asked for ' + origin + '.'];
  if (origin !== p) parts.push('Log Lens auto-runs only on URLs matching your pattern.');
  if (broad) parts.push('That is a very large set of sites.');
  if (P.pathIsExact(p)) parts.push('This path matches that one URL exactly — end it with * to cover everything under it.');
  grantEl.textContent = parts.join(' ');
  if (broad) grantEl.className = 'warn';
}

async function removeSite(pat) {
  const next = sites.filter((x) => x !== pat);
  const origin = P.toGrantOrigin(pat);
  // another pattern may still need the same origin — keep it then
  const stillUsed = origin && next.some((x) => P.toGrantOrigin(x) === origin);
  await chrome.storage.sync.set({ sites: next });
  if (origin && !stillUsed) chrome.permissions.remove({ origins: [origin] }).catch(() => {});
  load();
}

function makeRow(pat) {
  const li = document.createElement('li');
  const col = document.createElement('div');
  col.className = 'col';
  const label = document.createElement('span');
  label.className = 'pat';
  label.textContent = pat;
  col.appendChild(label);

  const origin = P.toGrantOrigin(pat);
  if (origin && origin !== P.normalizeInput(pat)) {
    const gr = document.createElement('span');
    gr.className = 'grant';
    gr.textContent = 'permission granted on ' + origin;
    col.appendChild(gr);
  }

  const btns = document.createElement('div');
  btns.className = 'btns';
  const rm = document.createElement('button');
  rm.className = 'rm';
  rm.textContent = 'remove';
  rm.addEventListener('click', () => removeSite(pat));
  btns.appendChild(rm);

  li.appendChild(col);
  li.appendChild(btns);

  // a permission revoked in chrome://extensions used to leave the row silently
  // dead — say so, and offer it back
  if (origin) {
    chrome.permissions.contains({ origins: [origin] }).then((ok) => {
      if (ok) return;
      li.classList.add('needsgrant');
      const note = document.createElement('span');
      note.className = 'grant warn';
      note.textContent = 'not auto-running — permission missing';
      col.appendChild(note);
      const g = document.createElement('button');
      g.className = 'rm';
      g.textContent = 'grant';
      g.addEventListener('click', () => {
        chrome.permissions.request({ origins: [origin] })
          .then((granted) => { if (granted) load(); else setErr('Permission was not granted.'); })
          .catch((e) => setErr('Chrome rejected this pattern: ' + e.message));
      });
      btns.insertBefore(g, rm);
    }).catch(() => {});
  }
  return li;
}

async function load() {
  const got = await chrome.storage.sync.get('sites');
  sites = Array.isArray(got.sites) ? got.sites : [];
  everyEl.checked = sites.indexOf(ALL_SITES) >= 0;
  listEl.textContent = '';
  for (const pat of sites) listEl.appendChild(makeRow(pat));
}

async function addPattern(p) {
  const got = await chrome.storage.sync.get('sites');
  const next = Array.isArray(got.sites) ? got.sites.slice() : [];
  if (next.indexOf(p) < 0) next.push(p);
  await chrome.storage.sync.set({ sites: next });
  load();
}

document.getElementById('add').addEventListener('click', () => {
  setErr('');
  const p = P.normalizeInput(input.value);
  if (!p) return;
  if (!P.parse(p)) {
    setErr('Not a valid URL pattern. Examples: https://logs.example.com/*  ·  *://*-staging.example.com/logs/*');
    return;
  }
  const origin = P.toGrantOrigin(p);
  // no await before this call — it needs the click gesture
  chrome.permissions.request({ origins: [origin] }).then((granted) => {
    if (!granted) { setErr('Permission was not granted — the site was not added.'); return; }
    input.value = '';
    describeGrant('');
    return addPattern(p);
  }).catch((e) => setErr('Chrome rejected this pattern: ' + e.message));
});

input.addEventListener('input', () => { setErr(''); describeGrant(input.value); });
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('add').click();
});

everyEl.addEventListener('change', () => {
  setErr('');
  if (!everyEl.checked) { removeSite(ALL_SITES); return; }
  chrome.permissions.request({ origins: [ALL_SITES] }).then((granted) => {
    if (!granted) { everyEl.checked = false; setErr('Permission was not granted.'); return; }
    return addPattern(ALL_SITES);
  }).catch((e) => { everyEl.checked = false; setErr('Chrome rejected this: ' + e.message); });
});

load();


/* ---------------- appearance ---------------- */

const THEME_DEFAULTS = {
  accent: '#c96f2e',
  text: '#3a2f21',
  key: '#b4531b',
  string: '#557a4e',
  number: '#c2601d',
  boolean: '#8c5e2a',
  bg: '#faf4e6',
  barBg: '#eee3cb',
  fontSize: 12,
};

const themeInputs = Array.from(document.querySelectorAll('.swatches [data-k]'));

function currentTheme() {
  const t = {};
  for (const inp of themeInputs) {
    const k = inp.dataset.k;
    t[k] = k === 'fontSize' ? parseInt(inp.value, 10) || THEME_DEFAULTS.fontSize : inp.value;
  }
  return t;
}

function fillInputs(theme) {
  for (const inp of themeInputs) {
    const k = inp.dataset.k;
    inp.value = (theme && theme[k] !== undefined) ? theme[k] : THEME_DEFAULTS[k];
  }
}

async function initTheme() {
  const { theme } = await chrome.storage.sync.get('theme');
  fillInputs(theme);
  window.LogLens.applyTheme(theme || {});
  for (const inp of themeInputs) {
    inp.addEventListener('input', () => {
      const t = currentTheme();
      window.LogLens.applyTheme(t); // live preview
      chrome.storage.sync.set({ theme: t }); // content scripts update live via storage.onChanged
    });
  }
  document.getElementById('theme-reset').addEventListener('click', () => {
    fillInputs(null);
    window.LogLens.applyTheme({});
    chrome.storage.sync.remove('theme');
  });
}
initTheme();
