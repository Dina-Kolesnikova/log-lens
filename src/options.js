const listEl = document.getElementById('list');
const input = document.getElementById('pattern');
const errEl = document.getElementById('err');

function validPattern(p) {
  // Chrome match pattern: <scheme>://<host>/<path>
  return /^(\*|https?|file):\/\/(\*|(\*\.)?[^\/*]+)?\/.*$/.test(p);
}

async function load() {
  const { sites = [] } = await chrome.storage.sync.get('sites');
  listEl.textContent = '';
  for (const p of sites) {
    const li = document.createElement('li');
    const span = document.createElement('span');
    span.textContent = p;
    const rm = document.createElement('button');
    rm.className = 'rm';
    rm.textContent = 'remove';
    rm.addEventListener('click', async () => {
      const next = sites.filter((x) => x !== p);
      await chrome.storage.sync.set({ sites: next });
      chrome.permissions.remove({ origins: [p] }).catch(() => {});
      load();
    });
    li.appendChild(span);
    li.appendChild(rm);
    listEl.appendChild(li);
  }
}

document.getElementById('add').addEventListener('click', async () => {
  errEl.textContent = '';
  let p = input.value.trim();
  if (!p) return;
  if (!p.includes('://')) p = 'https://' + p;
  if (!/\/[^]*$/.test(p.split('://')[1] || '')) p += '/*';
  if (!validPattern(p)) {
    errEl.textContent = 'Not a valid match pattern. Example: https://logs.example.com/*';
    return;
  }
  let granted = false;
  try {
    granted = await chrome.permissions.request({ origins: [p] });
  } catch (e) {
    errEl.textContent = 'Chrome rejected this pattern: ' + e.message;
    return;
  }
  if (!granted) {
    errEl.textContent = 'Permission was not granted — the site was not added.';
    return;
  }
  const { sites = [] } = await chrome.storage.sync.get('sites');
  if (!sites.includes(p)) {
    sites.push(p);
    await chrome.storage.sync.set({ sites });
  }
  input.value = '';
  load();
});
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('add').click();
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
