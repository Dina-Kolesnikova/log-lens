const { chromium } = require(process.env.PLAYWRIGHT_PKG || (process.env.HOME + '/Documents/Projects/Playwright-AI-Scaffold/node_modules/playwright'));
const EXT = __dirname + '/..';
const FIX = EXT + '/tests/fixtures';
let pass = 0, fail = 0;
function t(name, cond) { if (cond) { pass++; console.log('ok - ' + name); } else { fail++; console.error('FAIL - ' + name); } }

const PROFILE = require('os').tmpdir() + '/log-lens-smoke-profile';

(async () => {
  // a reused profile serves a CACHED service worker — the suite would then be
  // testing an older background.js than the one on disk
  require('fs').rmSync(PROFILE, { recursive: true, force: true });
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    executablePath: process.env.CHROMIUM_PATH || (process.env.HOME + '/Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'),
    headless: true,
        args: ['--disable-extensions-except=' + EXT, '--load-extension=' + EXT],
  });
  // wait for the MV3 service worker
  let sw = ctx.serviceWorkers()[0];
  if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 20000 }).catch(() => null);
  t('service worker registered', !!sw);
  const extId = sw ? new URL(sw.url()).host : null;

  // the worker importScripts()es the pattern engine; if that ever breaks,
  // nothing auto-runs anywhere and no other test would notice
  if (sw) {
    const grant = await sw.evaluate(() => (
      typeof globalThis.LLPatterns === 'object'
        ? LLPatterns.toGrantOrigin('https://*-staging.example.com/log-viewer/*')
        : null
    )).catch(() => null);
    t('service worker loaded the pattern engine', grant === 'https://*.example.com/*');
  }

  if (extId) {
    // options page opens and accepts a site pattern (storage write)
    const opt = await ctx.newPage();
    await opt.goto('chrome-extension://' + extId + '/src/options.html');
    t('options page renders', await opt.locator('#add').count() === 1);
    t('options: theme pickers present', await opt.locator('.swatches [data-k]').count() === 9);
    t('options: live preview styled', await opt.locator('#preview .ll-key').first().evaluate((el) => getComputedStyle(el).color) === 'rgb(180, 83, 27)');
    t('options: every-site toggle present', await opt.locator('#everysite').count() === 1);

    // a mid-host wildcard is ours, not Chrome's: accepted, and the grant
    // preview shows the wider origin Chrome will actually be asked for.
    // Clicking "Add site" is not asserted here — the optional-permission
    // dialog cannot be accepted in headless Chrome.
    await opt.locator('#pattern').fill('https://*-staging.example.com/log-viewer/*');
    await opt.waitForTimeout(100);
    const info = await opt.locator('#grantinfo').textContent();
    t('options: mid-host wildcard previews the widened grant', info.includes('https://*.example.com/*'));
    t('options: preview explains the local filter', info.includes('only on URLs matching your pattern'));
    t('options: mid-host wildcard is not rejected', (await opt.locator('#err').textContent()).trim() === '');

    // a wildcard-less path is a common footgun — the preview calls it out
    await opt.locator('#pattern').fill('https://logs.example.com/api/v2');
    await opt.waitForTimeout(100);
    t('options: exact-path nudge', (await opt.locator('#grantinfo').textContent()).includes('end it with *'));

    // structurally broken input still gets rejected on Add
    await opt.locator('#pattern').fill('https://');
    await opt.locator('#add').click();
    await opt.waitForTimeout(100);
    t('options: malformed pattern rejected', (await opt.locator('#err').textContent()).includes('Not a valid URL pattern'));

    // popup page renders (as a tab)
    const pop = await ctx.newPage();
    await pop.goto('chrome-extension://' + extId + '/src/popup.html');
    t('popup renders 3 buttons', await pop.locator('button').count() === 3);

    // standalone paste viewer works end-to-end
    const sa = await ctx.newPage();
    await sa.goto('chrome-extension://' + extId + '/src/standalone.html');
    await sa.locator('#in').fill('header line\n{"alpha":{"beta":[1,2,3]},"token":"xyz"}');
    await sa.locator('#render').click();
    t('paste viewer renders tree', await sa.locator('.ll-key', { hasText: 'alpha' }).count() >= 1);
    await sa.locator('.ll-search').fill('beta');
    await sa.waitForTimeout(400);
    t('paste viewer search', /1\s*\/\s*1/.test(await sa.locator('.ll-count').textContent()));
  }

  await ctx.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
