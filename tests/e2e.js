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

  /* ---- on/off switch: inline mode ---- */
  t('toggle: no pill while ON', await page.locator('.ll-badge-toggle:visible').count() === 0);
  t('toggle: toolbar has off button', await page.locator('.ll-btn2.ll-power').count() === 2);
  await page.locator('.ll-btn2.ll-power').first().click();
  t('toggle off: viewers hidden', await page.locator('.ll-root:visible').count() === 0);
  t('toggle off: original block restored', await page.locator('#context-block:visible').count() === 1);
  t('toggle off: pill appears', await page.locator('.ll-badge-toggle.ll-off:visible').count() === 1);
  await page.locator('.ll-badge-toggle').click();
  t('toggle on: viewers back', await page.locator('.ll-root:visible').count() === 2);
  t('toggle on: original hidden again', await page.locator('#context-block:visible').count() === 0);
  t('toggle on: pill gone', await page.locator('.ll-badge-toggle:visible').count() === 0);

  // drag the pill: turn off again, drag, verify it did NOT toggle back on
  await page.locator('.ll-btn2.ll-power').first().click();
  const pill = page.locator('.ll-badge-toggle');
  const box = await pill.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x - 300, box.y - 200, { steps: 5 });
  await page.mouse.up();
  t('pill: drag does not toggle', await page.locator('.ll-root:visible').count() === 0);
  const box2 = await pill.boundingBox();
  t('pill: actually moved', Math.abs(box2.x - box.x) > 100);
  await pill.click();
  t('pill: click after drag re-enables', await page.locator('.ll-root:visible').count() === 2);

  /* ---- tab-scoped OFF: survives reload in the tab, new tabs start ON ---- */
  await page.locator('.ll-btn2.ll-power').first().click();
  await page.reload();
  await inject(page);
  await page.waitForTimeout(300);
  t('tabscope: OFF survives reload in same tab', await page.locator('.ll-root:visible').count() === 0);
  t('tabscope: pill offered after reload', await page.locator('.ll-badge-toggle.ll-off:visible').count() === 1);

  const freshTab = await browser.newPage();
  await freshTab.goto('file://' + FIX + '/inline.html');
  await inject(freshTab);
  await freshTab.waitForTimeout(300);
  t('tabscope: new tab starts enhanced (ON default)', await freshTab.locator('.ll-root:visible').count() === 1);
  await freshTab.close();

  await page.locator('.ll-badge-toggle').click();
  t('tabscope: pill re-enables reloaded tab', await page.locator('.ll-root:visible').count() === 1);
  await page.reload();
  await inject(page);
  await page.waitForTimeout(300);
  t('tabscope: ON also survives reload', await page.locator('.ll-root:visible').count() === 1);

  /* ---- theming ---- */
  await page.evaluate(() => window.LogLens.applyTheme({ key: '#ff0000', fontSize: 15, accent: '#008000' }));
  const keyColor = await page.locator('.ll-key').first().evaluate((el) => getComputedStyle(el).color);
  t('theme: key color applied', keyColor === 'rgb(255, 0, 0)');
  const fs = await page.locator('.ll-root').first().evaluate((el) => getComputedStyle(el).fontSize);
  t('theme: font size applied', fs === '15px');
  const brandColor = await page.locator('.ll-brand').first().evaluate((el) => getComputedStyle(el).color);
  t('theme: accent applied to brand', brandColor === 'rgb(0, 128, 0)');
  // invalid values are ignored (no CSS injection, no crash)
  await page.evaluate(() => window.LogLens.applyTheme({ key: 'red;} body{display:none', fontSize: 99 }));
  t('theme: invalid values ignored', await page.locator('body:visible').count() === 1 &&
    (await page.locator('.ll-root').first().evaluate((el) => getComputedStyle(el).fontSize)) === '12px');
  await page.evaluate(() => window.LogLens.applyTheme({}));

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
  await page2.locator('.ll-btn2', { hasText: /^raw$/ }).click();

  // on/off in full-page mode restores the original document
  await page2.locator('.ll-btn2.ll-power').click();
  t('raw toggle off: original body restored',
    await page2.locator('body:not(.ll-page)').count() === 1 &&
    await page2.locator('.ll-root').count() === 0 &&
    (await page2.locator('body').textContent()).includes('location-details'));
  await page2.locator('.ll-badge-toggle').click();
  t('raw toggle on: viewer restored', await page2.locator('body.ll-page .ll-root').count() === 1);

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
