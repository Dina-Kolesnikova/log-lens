# ⌕ Log Lens — JSON Log Viewer

Chrome extension that turns the raw JSON walls in web-based log viewers into
an interactive tree: collapse/expand, search across keys **and** values,
one-click copy (value / path / subtree), and automatic parsing of
JSON-stringified-inside-strings (session data, stringified request/response
bodies).

Everything runs locally inside the page — **no data ever leaves the browser**.
Logs often carry auth tokens and PII; Log Lens makes no network requests and
collects nothing.

## How it runs

- **Auto-run sites** — add your own log-viewer URLs in the extension options
  (toolbar icon → "Auto-run sites…"). Log Lens registers itself only on the
  patterns you add, and only after Chrome asks you to grant that site.
- **Any other page** — click the toolbar icon → **Enhance this page**.
- **Paste viewer** — toolbar icon → "Open paste viewer" for log text copied
  from anywhere; it accepts pure JSON or mixed preamble + JSON dumps.

Two detection modes, applied automatically:

| Page shape | Behavior |
|---|---|
| Whole document is raw JSON, or text with embedded JSON (raw log dumps) | full-page tree, preamble text kept above it |
| HTML log viewer rendering JSON blobs inline (tables, detail modals, SPAs) | each blob is swapped for a tree with a per-block "raw" toggle; SPA re-renders are caught by a MutationObserver |

## Features

- **Tree view** with lazy rendering — multi-MB payloads don't freeze the tab;
  huge arrays render in batches of 200 with a "show more" button.
- **Search** matches keys and values, *including inside collapsed nodes and
  inside parsed JSON-strings*. Enter/Shift+Enter or ◀ ▶ jump between matches;
  "matches only" hides everything else.
- **Depth buttons** `1 2 3 all −` to expand/collapse in one click.
- **Hover any row** → `copy` (value, or subtree as pretty JSON), `path`
  (e.g. `$.request.headers.authorization[0]`), and `copy parsed` on
  str→json nodes.
- **Row actions**: hover any row for `copy JSON` (the whole object/array,
  pretty-printed), `copy` (a single value) and `path`
  (e.g. `$.request.headers.authorization[0]`). They always sit at the row's
  right edge, so a long value never pushes them out of reach.
- **Normal text selection**: drag-select anywhere in the tree and copy with
  the keyboard — selecting never expands or collapses a node, and the `▶`
  glyphs and button labels stay out of the copied text.
- **`str→json` badge**: a string value that contains JSON is parsed and
  rendered as a subtree. `copy` still copies the original string.
- **raw** button restores the original text at any time; **copy JSON**
  copies the whole pretty-printed document.
- **On/off switch**: every viewer toolbar has an `off` button that restores
  the untouched original view (works inside modals too). While off, a small
  draggable "Log Lens OFF" pill floats on the page to turn it back on.
  **ON is always the default** — OFF holds only for the current tab
  (surviving reloads there); new tabs and sessions open enhanced. The
  toolbar popup has the same "Tree view in this tab" switch as a fallback.

### Appearance

Extension options → **Appearance**: color pickers for buttons/accent, font
color, keys, strings, numbers, booleans, backgrounds, plus font size — with
a live preview. Changes apply instantly to every open Log Lens view and
sync with your Chrome profile. "Reset to defaults" restores the stock look.

## Install

From the Chrome Web Store (when published), or unpacked:

1. Chrome → `chrome://extensions`
2. Toggle **Developer mode** (top right)
3. **Load unpacked** → select this folder
4. Pin "Log Lens" to the toolbar and add your log sites in options

## Privacy

- No analytics, no remote requests, no data collection of any kind.
- Host access is **optional and user-granted per site**; the only default
  permissions are `activeTab`/`scripting` (used when you click the toolbar
  button), `storage` (your site list), and `clipboardWrite` (copy buttons).

## Development

Plain vanilla JS, zero dependencies, no build step.

```
src/jsontree.js    tree renderer + search + text→segments parser (window.LogLens)
src/jsontree.css   all styles
src/content.js     page detection: full-page raw mode + inline mode + SPA MutationObserver
src/background.js  registers content scripts for the user's auto-run sites
src/options.*      auto-run site list (match patterns + permission requests)
src/popup.*        toolbar popup (inject / paste viewer / options)
src/standalone.*   paste viewer page
tests/             node parser tests + Playwright e2e
```

Run tests:

```bash
node tests/test_segments.js   # pure parser tests, no browser
node tests/e2e.js             # drives installed Chrome via playwright-core
                              # (set PLAYWRIGHT_CORE to your playwright-core path if needed)
```

## Known limits

- "expand all" caps at 25k nodes on giant payloads (a note appears); search
  still covers everything because it walks the data, not the DOM.
- Search caps at 2000 matches (shown as `2000+`).
- If a JSON block on some viewer isn't auto-detected (exotic markup), use
  the toolbar button — and open an issue with the page structure so an
  adapter can be added.
