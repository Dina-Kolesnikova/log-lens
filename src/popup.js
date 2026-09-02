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

async function initTabToggle() {
  const row = document.getElementById('siterow');
  const cb = document.getElementById('sitetoggle');
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let state = null;
  try {
    // a busy page can be slow to answer — never let that stall the popup
    state = await Promise.race([
      chrome.tabs.sendMessage(tab.id, { type: 'll-get-state' }),
      new Promise((resolve) => setTimeout(() => resolve(null), 400)),
    ]);
  } catch (e) { /* no content script on this page */ }
  if (!state || !state.active) { row.style.display = 'none'; return; }
  cb.checked = state.enabled;
  cb.addEventListener('change', () => {
    chrome.tabs.sendMessage(tab.id, { type: 'll-set-enabled', on: cb.checked }).catch(() => {});
  });
}
// let the popup paint before doing any async work
requestAnimationFrame(() => initTabToggle());
