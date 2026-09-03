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
    // no extension context here: this exercises the manual toolbar path, which
    // bypasses the auto-run gate in content.js
    await p.evaluate(() => { window.__logLensManual = true; });
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

  /* ---- text selection & row copy actions ---- */
  // dragging across rows must select text, never toggle a node
  const rowA = await page.locator('.ll-row', { hasText: 'roomRates' }).first().boundingBox();
  const rowB = await page.locator('.ll-row', { hasText: 'acmesupplier' }).first().boundingBox();
  await page.mouse.move(rowA.x + 30, rowA.y + rowA.height / 2);
  await page.mouse.down();
  await page.mouse.move(rowB.x + 90, rowB.y + rowB.height / 2, { steps: 8 });
  await page.mouse.up();
  const selText = await page.evaluate(() => String(window.getSelection()));
  t('selection: drag selects text', selText.length > 5);
  t('selection: drag did not collapse the tree',
    await page.locator('.ll-string', { hasText: 'acmesupplier' }).count() === 1);
  t('selection: toggle glyphs excluded from copied text', !selText.includes('▶') && !selText.includes('▼'));
  await page.evaluate(() => window.getSelection().removeAllRanges());

  // object rows offer a clearly-labelled subtree copy, pinned to the row's right edge
  const objRow = page.locator('.ll-row', { hasText: 'response' }).first();
  await objRow.hover();
  const objCopy = objRow.locator('.ll-btn').first();
  t('copy: object row pill reads "copy JSON"', (await objCopy.textContent()) === 'copy JSON');
  const toolsBox = await objRow.locator('.ll-tools').boundingBox();
  const rowBox = await objRow.boundingBox();
  t('copy: actions sit next to the row text, not at the window edge',
    toolsBox.x - rowBox.x < 200 && (rowBox.x + rowBox.width) - toolsBox.x > 200);
  await objCopy.click();
  await page.waitForTimeout(120);
  t('copy: click confirms with ✓', (await objCopy.textContent()) === '✓');
  await page.waitForTimeout(700);

  /* ---- smart copy (selection → JSON) ---- */
  await page.evaluate(() => {
    window.__copied = null;
    document.addEventListener('copy', (e) => { window.__copied = e.clipboardData.getData('text/plain'); });
  });
  async function selectRows(fromText, toText) {
    const a = await page.locator('.ll-row', { hasText: fromText }).first().boundingBox();
    const b = await page.locator('.ll-row', { hasText: toText }).first().boundingBox();
    await page.mouse.move(a.x + 30, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + 90, b.y + b.height / 2, { steps: 8 });
    await page.mouse.up();
  }

  await selectRows('roomRates', 'acmesupplier');
  await page.evaluate(() => { window.__copied = null; document.execCommand('copy'); });
  const copied = await page.evaluate(() => window.__copied);
  let parsed = null;
  try { parsed = JSON.parse(copied); } catch (e) { /* left null */ }
  t('smartcopy: multi-row selection copies JSON', parsed !== null);
  t('smartcopy: JSON carries the values', parsed && parsed.supplier === 'acmesupplier' &&
    Array.isArray(parsed.roomRates) && parsed.roomRates.length === 5);

  // collapsed children must still be present in the copied JSON
  await page.locator('.ll-btn2', { hasText: /^1$/ }).first().click(); // collapse to depth 1
  await page.waitForTimeout(150);
  await selectRows('request', 'response');
  await page.evaluate(() => { window.__copied = null; document.execCommand('copy'); });
  const copied2 = await page.evaluate(() => window.__copied);
  let parsed2 = null;
  try { parsed2 = JSON.parse(copied2); } catch (e) { /* left null */ }
  t('smartcopy: collapsed children included',
    parsed2 && parsed2.response && parsed2.response.supplier === 'acmesupplier');

  // a selection inside a single row keeps native plain-text copy
  await page.locator('.ll-btn2', { hasText: /^all$/ }).first().click();
  await page.waitForTimeout(150);
  const one = await page.locator('.ll-string', { hasText: 'acmesupplier' }).first().boundingBox();
  await page.mouse.move(one.x + 4, one.y + one.height / 2);
  await page.mouse.down();
  await page.mouse.move(one.x + one.width - 4, one.y + one.height / 2, { steps: 5 });
  await page.mouse.up();
  await page.evaluate(() => { window.__copied = null; document.execCommand('copy'); });
  const copied3 = await page.evaluate(() => window.__copied);
  t('smartcopy: single-row selection stays plain text', !copied3);
  await page.evaluate(() => window.getSelection().removeAllRanges());

  t('toolbar: inspector button gone', await page.locator('.ll-btn2', { hasText: /^inspector$/ }).count() === 0);
  t('toolbar: no inspector pane', await page.locator('.ll-inspector').count() === 0);

  /* ---- theming ---- */
  await page.evaluate(() => window.LogLens.applyTheme({ key: '#ff0000', fontSize: 15, accent: '#008000' }));
  const keyColor = await page.locator('.ll-key').first().evaluate((el) => getComputedStyle(el).color);
  t('theme: key color applied', keyColor === 'rgb(255, 0, 0)');
  const fs = await page.locator('.ll-root').first().evaluate((el) => getComputedStyle(el).fontSize);
  t('theme: font size applied', fs === '15px');
  const brandBg = await page.locator('.ll-brand-icon').first().evaluate((el) => getComputedStyle(el).backgroundColor);
  t('theme: accent applied to brand icon', brandBg === 'rgb(0, 128, 0)');
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

  /* ---- filtered search + bulk expand (regression: "all" did nothing) ----
   * Every entry carries a fat `history` array, so a whole-document expand
   * really does run past EXPAND_BUDGET — which is why the old expandAll(),
   * walking from the root and spending budget on leaves too, never reached the
   * matched nodes the filter had left on screen. */
  const page4 = await browser.newPage();
  await page4.setContent('<pre id="big"></pre>');
  await page4.evaluate(() => {
    const rates = [];
    for (let i = 0; i < 1500; i++) {
      const history = [];
      for (let h = 0; h < 20; h++) history.push({ step: h, at: '2026-09-01T00:00:0' + (h % 10) + 'Z', by: 'svc' });
      rates.push({
        hotelId: 'H' + i,
        roomCode: 'RC' + i,
        tags: ['refundable', 'breakfast', 'wifi'],
        taxes: { hotelTax: i * 0.1, cityTax: 2, total: i * 0.1 + 2 },
        history,
        rate: {
          baseAmount: 100 + i,
          currency: 'CAD',
          cancellationPolicy: [{ amount: 250 + i, currency: 'CAD', fromDate: '2026-09-01', penaltyType: 'FIXED' }],
        },
      });
    }
    document.getElementById('big').textContent = JSON.stringify(rates);
  });
  await inject(page4);
  await page4.waitForTimeout(400);
  const cnt4 = page4.locator('.ll-count');
  await page4.locator('.ll-search').fill('cancellationPolicy');
  await page4.waitForTimeout(1200);
  t('filter: 1500 key matches found', /1\s*\/\s*1500/.test(await cnt4.textContent()));

  await page4.locator('.ll-filterlbl input').check();
  await page4.waitForFunction(() => document.querySelectorAll('.ll-keep-hit').length >= 1500,
    null, { timeout: 30000 }).catch(() => {});
  t('filter: every match kept, none silently dropped',
    await page4.locator('.ll-keep-hit').count() === 1500);

  await page4.locator('.ll-group button', { hasText: /^all$/ }).click();
  await page4.waitForFunction(() => {
    const hits = Array.from(document.querySelectorAll('.ll-keep-hit'));
    return hits.length > 0 && hits.every((n) => {
      const k = n.querySelector(':scope > .ll-children');
      return k && !k.hidden;
    });
  }, null, { timeout: 30000 }).catch(() => {});
  const openState = await page4.evaluate(() => {
    const hits = Array.from(document.querySelectorAll('.ll-keep-hit'));
    const open = hits.filter((n) => {
      const k = n.querySelector(':scope > .ll-children');
      const tg = n.querySelector(':scope > .ll-row > .ll-toggle');
      return k && !k.hidden && tg && tg.textContent === '\u25bc';
    });
    return { total: hits.length, open: open.length };
  });
  t('all: every match expanded (' + openState.open + '/' + openState.total + ')',
    openState.total === 1500 && openState.open === 1500);
  t('all: a leaf inside a match is actually visible',
    await page4.locator('.ll-keep-hit .ll-key', { hasText: 'penaltyType' }).first().isVisible());
  t('all: budget not spent on the hidden document',
    !/expanded first/.test(await cnt4.textContent()));
  t('all: match counter survives the expand',
    /1\s*\/\s*1500/.test(await cnt4.textContent()));

  await page4.locator('.ll-group button', { hasText: /^2$/ }).click();
  await page4.waitForTimeout(500);
  t('depth 2 during a filtered search keeps the matches on screen',
    await page4.locator('.ll-keep-hit').first().isVisible());
  await page4.locator('.ll-group button', { hasText: '\u2212' }).click();
  await page4.waitForTimeout(500);
  t('collapse during a filtered search keeps the matches on screen',
    await page4.locator('.ll-keep-hit').first().isVisible());

  await page4.locator('.ll-filterlbl input').uncheck();
  await page4.waitForTimeout(300);
  t('unfiltered again: non-matching siblings are back',
    await page4.locator('.ll-key', { hasText: 'hotelId' }).first().isVisible());

  /* ---- the cap message is still shown when it is real, and still hands the
   * counter back afterwards. Separate payload: 200 x 200 objects is past the
   * budget while staying cheap to render. ---- */
  const page5 = await browser.newPage();
  await page5.setContent('<pre id="deep"></pre>');
  await page5.evaluate(() => {
    const doc = { needle_key: 'find-me' };
    for (let i = 0; i < 200; i++) {
      const inner = {};
      for (let j = 0; j < 200; j++) inner['k' + j] = { v: j };
      doc['g' + i] = inner;
    }
    document.getElementById('deep').textContent = JSON.stringify(doc);
  });
  await inject(page5);
  await page5.waitForTimeout(300);
  const cnt5 = page5.locator('.ll-count');
  await page5.locator('.ll-search').fill('find-me');
  await page5.waitForTimeout(600);
  t('cap: search finds the needle', /1\s*\/\s*1/.test(await cnt5.textContent()));
  await page5.locator('.ll-group button', { hasText: /^all$/ }).click();
  const capped = await page5.waitForFunction(
    () => /expanded first/.test(document.querySelector('.ll-count').textContent),
    null, { timeout: 30000 }).then(() => true).catch(() => false);
  t('cap: reported when the budget really runs out', capped);
  await page5.waitForTimeout(2800);
  t('cap: counter restored after the message', /1\s*\/\s*1/.test(await cnt5.textContent()));

  /* ---- v1.8: pins, copy-as-table, tooltips, row links ---- */
  const page6 = await browser.newPage();
  page6.setDefaultTimeout(4000); // fail fast instead of hanging on a bad locator
  await page6.setContent('<pre id="p"></pre>');
  await page6.evaluate(() => {
    const data = {
      hotel: 'X',
      rooms: [
        { id: 1, name: 'King', price: { total: 1108.93, currency: 'CAD' }, tags: ['a', 'b'] },
        { id: 2, name: 'Twin', price: { total: 989.1, currency: 'CAD' }, tags: ['c'] },
        { id: 3, name: 'Suite', price: { total: 2000, currency: 'USD' }, tags: [] },
      ],
      meta: { created: '2026-08-27T14:47:44.115Z', big: 123456 },
    };
    document.getElementById('p').textContent = JSON.stringify(data);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: (t) => { window.__copiedText = t; return Promise.resolve(); } },
      configurable: true,
    });
  });
  await inject(page6);
  await page6.waitForTimeout(300);

  // tooltips (meta.* rendered at default depth 2)
  const isoTitle = await page6.locator('.ll-val', { hasText: '2026-08-27T14:47' }).first().getAttribute('title');
  t('tooltip: ISO timestamp gets local + relative time', !!isoTitle && /ago|from now/.test(isoTitle));
  const numTitle = await page6.locator('.ll-val', { hasText: /^123456$/ }).first().getAttribute('title');
  t('tooltip: big number gets thousands separators', !!numTitle && /123[,.  ']456/.test(numTitle));

  // pins: render the deep rows, pin "total" from a row
  await page6.locator('.ll-group button', { hasText: /^all$/ }).click();
  await page6.waitForTimeout(200);
  const totalRow = page6.locator('.ll-row', { has: page6.locator('.ll-key', { hasText: /^total$/ }) }).first();
  await totalRow.hover();
  await totalRow.locator('button', { hasText: /^pin$/ }).click();
  await page6.waitForTimeout(100);
  t('pins: strip appears', await page6.locator('.ll-pinstrip:visible').count() === 1);
  t('pins: chip shows key', (await page6.locator('.ll-pin-key').first().textContent()) === 'total');
  t('pins: chip shows occurrence count', /^3✕$/.test(await page6.locator('.ll-pin-count').first().textContent()));
  t('pins: chip shows first value', (await page6.locator('.ll-pin-val').first().textContent()).includes('1108.93'));

  // click-to-jump cycles occurrences
  await page6.locator('.ll-pin').first().click();
  await page6.waitForTimeout(100);
  t('pins: first click jumps (1/3)', /1\/3/.test(await page6.locator('.ll-pin-count').first().textContent())
    && await page6.locator('.ll-current-hit').count() === 1);
  const hit1 = await page6.locator('.ll-current-hit').first().evaluate((n) => n.closest('.ll-row').textContent);
  await page6.locator('.ll-pin').first().click();
  await page6.waitForTimeout(100);
  const hit2 = await page6.locator('.ll-current-hit').first().evaluate((n) => n.closest('.ll-row').textContent);
  t('pins: second click moves to the next occurrence (2/3)',
    /2\/3/.test(await page6.locator('.ll-pin-count').first().textContent()) && hit1 !== hit2);
  t('pins: chip value tracks the current occurrence',
    (await page6.locator('.ll-pin-val').first().textContent()).includes('989.1'));

  // ‹ steps back; wraps past the start
  await page6.locator('.ll-pin-nav', { hasText: '‹' }).click();
  await page6.waitForTimeout(100);
  const hitBack = await page6.locator('.ll-current-hit').first().evaluate((n) => n.closest('.ll-row').textContent);
  t('pins: ‹ steps back to 1/3',
    /1\/3/.test(await page6.locator('.ll-pin-count').first().textContent())
    && hitBack === hit1
    && (await page6.locator('.ll-pin-val').first().textContent()).includes('1108.93'));
  await page6.locator('.ll-pin-nav', { hasText: '‹' }).click();
  await page6.waitForTimeout(100);
  t('pins: ‹ from the start wraps to 3/3',
    /3\/3/.test(await page6.locator('.ll-pin-count').first().textContent())
    && (await page6.locator('.ll-pin-val').first().textContent()).includes('2000'));
  await page6.locator('.ll-pin-nav', { hasText: '›' }).click();
  await page6.waitForTimeout(100);
  t('pins: › wraps forward to 1/3',
    /1\/3/.test(await page6.locator('.ll-pin-count').first().textContent()));

  // a pinned key absent from this log renders dimmed, never errors
  await page6.evaluate(() => window.LogLens.setPins(['total', 'no_such_key_zz']));
  await page6.waitForTimeout(100);
  t('pins: absent key renders dimmed with —',
    await page6.locator('.ll-pin.ll-pin-empty', { hasText: 'no_such_key_zz' }).count() === 1
    && (await page6.locator('.ll-pin.ll-pin-empty .ll-pin-val').textContent()) === '—');

  // unpin from the chip
  await page6.locator('.ll-pin.ll-pin-empty .ll-pin-x').click();
  await page6.waitForTimeout(100);
  t('pins: unpin removes the chip', await page6.locator('.ll-pin').count() === 1);
  await page6.locator('.ll-pin .ll-pin-x').click();
  await page6.waitForTimeout(100);
  t('pins: last unpin hides the strip', await page6.locator('.ll-pinstrip:visible').count() === 0);

  // copy as table on the rooms array
  const roomsRow = page6.locator('.ll-row', { has: page6.locator('.ll-key', { hasText: /^rooms$/ }) }).first();
  await roomsRow.hover();
  await roomsRow.locator('button', { hasText: /^copy table$/ }).click();
  await page6.waitForTimeout(100);
  const tsv = await page6.evaluate(() => window.__copiedText);
  const lines = (tsv || '').split('\n');
  t('table: header has flattened dot-columns',
    lines[0] === 'id\tname\tprice.total\tprice.currency\ttags');
  t('table: one row per item + header', lines.length === 4);
  t('table: values land in cells', lines[1].includes('1108.93') && lines[3].includes('USD'));
  t('table: deep/array cells use the preview', /\[ 2 items \]/.test(lines[1]));
  t('table: no button on a scalar row',
    await totalRow.locator('button', { hasText: /^copy table$/ }).count() === 0);

  // row link: copy #ll= and restore it on a fresh page
  const idRow = page6.locator('.ll-row', { has: page6.locator('.ll-key', { hasText: /^id$/ }) }).first();
  await idRow.hover();
  await idRow.locator('button', { hasText: '🔗' }).click();
  await page6.waitForTimeout(100);
  const link = await page6.evaluate(() => window.__copiedText);
  t('link: copies a #ll= url', /#ll=/.test(link || '')
    && decodeURIComponent(link.split('#ll=')[1]) === '$.rooms[0].id');

  const page7 = await browser.newPage();
  page7.setDefaultTimeout(4000);
  await page7.setContent('<pre id="p"></pre>');
  await page7.evaluate(() => {
    document.getElementById('p').textContent = JSON.stringify({
      rooms: [
        { id: 1, price: { total: 1108.93 } },
        { id: 2, price: { total: 989.1 } },
        { id: 3, price: { total: 2000 } },
      ],
    });
    location.hash = '#ll=' + encodeURIComponent('$.rooms[2].price.total');
  });
  await inject(page7);
  await page7.waitForTimeout(300);
  t('link: #ll= hash restores, renders and highlights the row',
    await page7.locator('.ll-current-hit').count() === 1
    && (await page7.locator('.ll-current-hit').first().evaluate((n) => n.closest('.ll-row').textContent)).includes('2000'));

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
