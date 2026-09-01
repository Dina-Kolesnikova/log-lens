document.getElementById('enhance').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ['src/jsontree.css'] });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['src/jsontree.js', 'src/content.js'] });
  } catch (e) {
    // chrome:// pages etc. can't be injected — nothing to do
  }
  window.close();
});
document.getElementById('paste').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('src/standalone.html') });
});
document.getElementById('options').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

(async function initSiteToggle() {
  const row = document.getElementById('siterow');
  const cb = document.getElementById('sitetoggle');
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let origin = null;
  try { origin = new URL(tab.url).origin; } catch (e) { /* chrome:// etc. */ }
  if (!origin || !/^https?:/.test(origin)) { row.style.display = 'none'; return; }
  const key = 'll-off:' + origin;
  const st = await chrome.storage.local.get(key);
  cb.checked = !st[key];
  cb.addEventListener('change', () => {
    if (cb.checked) chrome.storage.local.remove(key);
    else chrome.storage.local.set({ [key]: true });
  });
})();
