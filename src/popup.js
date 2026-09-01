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
