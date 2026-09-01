const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || (process.env.HOME + '/Documents/Projects/Playwright-AI-Scaffold/node_modules/playwright-core'));
const SRC = __dirname + '/../src';
const FIX = __dirname + '/fixtures';

let pass = 0, fail = 0;
function t(name, cond) { if (cond) { pass++; console.log('ok - ' + name); } else { fail++; console.error('FAIL - ' + name); } }

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();

  async function inject(p) {
    await p.addStyleTag({ path: SRC + '/jsontree.css' });
    await p.addScriptTag({ path: SRC + '/jsontree.js' });
    await p.addScriptTag({ path: SRC + '/content.js' });
  }

  /* ---- inline mode ---- */
  await page.goto('file://' + FIX + '/inline.html');
  await inject(page);
  await page.waitForTimeout(200);

  t('inline: viewer mounted', await page.locator('.ll-root').count() === 1);
  t('inline: original hidden', await page.locator('#context-block.ll-hidden-original').count() === 1);
  t('inline: small text block untouched', await page.locator('#small:not(.ll-hidden-original)').count() === 1);
  // default depth-2 expansion shows "request"
  t('inline: keys rendered', await page.locator('.ll-key', { hasText: 'request' }).count() >= 1);

  // nested JSON-in-string: expand request -> body should carry str→json badge
  await page.locator('.ll-key', { hasText: /^request$/ }).first().click();
  t('inline: str→json badge', await page.locator('.ll-badge').count() >= 1);

  // search across keys+values incl. inside the nested JSON string
  await page.locator('.ll-search').fill('itemId');
  await page.waitForTimeout(400);
  const countText = await page.locator('.ll-count').textContent();
  t('inline: search finds key inside parsed string (' + countText.trim() + ')', /1\s*\/\s*1/.test(countText));
  t('inline: current hit highlighted', await page.locator('.ll-current-hit').count() === 1);

  // search a value
  await page.locator('.ll-search').fill('acmesupplier');
  await page.waitForTimeout(400);
  t('inline: value search hits', /1\s*\/\s*1/.test(await page.locator('.ll-count').textContent()));

  // matches-only filter
  await page.locator('.ll-filterlbl input').check();
  await page.waitForTimeout(100);
  const visibleSupplier = await page.locator('.ll-keep-hit').count();
  t('inline: filter keeps match branch', visibleSupplier >= 1);
  await page.locator('.ll-filterlbl input').uncheck();

  // collapse / expand controls
  await page.locator('.ll-btn2', { hasText: /^−$/ }).click();
  await page.locator('.ll-btn2', { hasText: /^all$/ }).click();
  t('inline: expand all shows deep scalar', await page.locator('.ll-string', { hasText: 'acmesupplier' }).count() === 1);

  // SPA mutation: new JSON block appears later
  await page.evaluate(() => {
    const pre = document.createElement('pre');
    pre.id = 'late';
    pre.textContent = JSON.stringify({ late: { added: true, arr: [1, 2, 3], sessionToken: 'abcdef0123456789abcdef0123456789' }, note: 'spa rerender xyz with a realistically sized payload body' });
    document.body.appendChild(pre);
  });
  await page.waitForTimeout(800);
  t('inline: SPA-added block enhanced', await page.locator('.ll-root').count() === 2);

  /* ---- full page raw mode ---- */
  const page2 = await browser.newPage();
  await page2.goto('file://' + FIX + '/raw.txt');
  await inject(page2);
  await page2.waitForTimeout(200);
  t('raw: full-page mode', await page2.locator('body.ll-page').count() === 1);
  t('raw: preamble kept as text', (await page2.locator('.ll-textseg').first().textContent()).includes('location-details'));
  t('raw: json tree rendered', await page2.locator('.ll-key', { hasText: 'User-Agent' }).count() === 1);
  // raw toggle
  await page2.locator('.ll-btn2', { hasText: /^raw$/ }).click();
  t('raw: toggle shows original', await page2.locator('.ll-raw:visible').count() === 1);

  /* ---- huge payload sanity (chunking + search perf) ---- */
  const page3 = await browser.newPage();
  await page3.setContent('<pre id="big"></pre>');
  await page3.evaluate(() => {
    const rooms = [];
    for (let i = 0; i < 3000; i++) rooms.push({ id: i, code: 'R' + i, price: { amount: i * 1.5, currency: 'USD' } });
    document.getElementById('big').textContent = JSON.stringify({ hotel: 'X', rooms, needle_key: 'find-me-9999' });
  });
  const t0 = Date.now();
  await inject(page3);
  await page3.waitForTimeout(300);
  const mountMs = Date.now() - t0;
  t('big: mounted in <3s (' + mountMs + 'ms)', mountMs < 3000 && await page3.locator('.ll-root').count() === 1);
  await page3.locator('.ll-search').fill('find-me-9999');
  await page3.waitForTimeout(500);
  t('big: search works', /1\s*\/\s*1/.test(await page3.locator('.ll-count').textContent()));
  // jump to a deep chunked index
  await page3.locator('.ll-search').fill('R2999');
  await page3.waitForTimeout(1500);
  t('big: match in chunked tail reachable', await page3.locator('.ll-current-hit').count() === 1);

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
