/* Log Lens — service worker.
 * Keeps dynamically registered content scripts in sync with the user's
 * auto-run site list (chrome.storage.sync "sites"). No hardcoded domains.
 */
async function syncRegistrations() {
  const { sites = [] } = await chrome.storage.sync.get('sites');
  try { await chrome.scripting.unregisterContentScripts({ ids: ['log-lens-auto'] }); } catch (e) { /* not registered yet */ }
  if (!sites.length) return;
  const granted = [];
  for (const pattern of sites) {
    try {
      if (await chrome.permissions.contains({ origins: [pattern] })) granted.push(pattern);
    } catch (e) { /* invalid pattern — skip */ }
  }
  if (!granted.length) return;
  await chrome.scripting.registerContentScripts([{
    id: 'log-lens-auto',
    matches: granted,
    js: ['src/jsontree.js', 'src/content.js'],
    css: ['src/jsontree.css'],
    runAt: 'document_idle',
  }]);
}

chrome.runtime.onInstalled.addListener(syncRegistrations);
chrome.runtime.onStartup.addListener(syncRegistrations);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.sites) syncRegistrations();
});
