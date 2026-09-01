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
