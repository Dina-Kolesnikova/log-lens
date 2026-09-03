# ⌕ Log Lens — JSON Log Viewer

Chrome extension that turns the raw JSON walls in web-based log viewers into
an interactive tree: collapse/expand, search across keys **and** values,
one-click copy (value / path / subtree), and automatic parsing of
JSON-stringified-inside-strings (session data, stringified request/response
bodies).

Everything runs locally inside the page — **no data ever leaves the browser**.
Logs often carry auth tokens and PII; Log Lens makes no network requests and
collects nothing.

**📖 Full instructions: [docs/USER-GUIDE.md](docs/USER-GUIDE.md)** — every
feature, task by task, with troubleshooting.

## How it runs

- **Auto-run sites** — add your own log-viewer URLs in the extension options
  (toolbar icon → "Auto-run sites…"). Log Lens runs itself only on the
  patterns you add, and only after Chrome asks you to grant access.
- **Everywhere** — tick **Auto-run on every site** in options for one
  all-sites grant and no patterns to maintain. JSON detection still decides
  whether a page gets a viewer, so ordinary pages are untouched.
- **Any other page** — click the toolbar icon → **Enhance this page**.
- **Paste viewer** — toolbar icon → "Open paste viewer" for log text copied
  from anywhere; it accepts pure JSON or mixed preamble + JSON dumps.
- **DevTools panel** — F12 → the "⌕ Log Lens" tab: pick any Fetch/XHR request
  and read its response body and request payload as the same tree (Chrome
  doesn't let extensions change the built-in Response tab, so Log Lens brings
  its own).

### Auto-run patterns

A pattern is `scheme://host/path`, and `*` is a wildcard **anywhere** in it:

```
https://logs.example.com/*                  one host
*://*.example.com/*                         a domain and its subdomains
https://*-staging.example.com/log-viewer/*   wildcard inside the host
*://*/*                                     every site
file:///Users/me/logs/*                      local files
```

End the path with `*` to cover everything under it; a wildcard-less path
matches that one URL exactly (options warns you about this).

Chrome's own match-pattern grammar cannot express a wildcard *inside* a host,
and permissions are granted per domain. So a pattern is used two ways: Log Lens
asks Chrome for the narrowest **legal superset** of it — `*-staging.example.com`
becomes `*.example.com` — and then filters locally down to the pattern you
actually typed. The line under the input always shows the origin Chrome will be
asked for, before it asks. Widening the grant never widens where Log Lens runs.

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
- **Pinned fields (watch strip)**: hover any row → `pin` to keep that key in a
  strip above the tree. Each chip shows the key, how many times it occurs and
  the value at the current stop; click the chip (or ›) for the next
  occurrence, ‹ for the previous — wrapping at the ends. Keys absent
  from the current page show dimmed as `—`. Pins sync with your Chrome
  profile, so your usual fields greet you on every log page.
- **Depth buttons** `1 2 3 all −` to expand/collapse in one click. While
  **matches only** is on they act *inside the matches* — `all` expands every
  matched subtree, `1 2 3` go N levels deep under each match — so the expand
  budget is never spent on the part of the document the filter is hiding.
- **Hover any row** → actions right beside the row's own text: `copy`
  (`copy JSON` on objects/arrays, pretty-printed), `path`
  (e.g. `$.request.headers.authorization[0]`), `copy parsed` on str→json
  nodes, `pin`, and `🔗`.
- **Copy as table**: on an array of similar objects, `copy table` puts a
  TSV on the clipboard — flattened dot-columns (`price.total`), one row per
  item — that pastes straight into a spreadsheet or issue tracker.
- **Row links**: `🔗` copies the page URL with a `#ll=<path>` fragment; opening
  it renders, highlights and scrolls to that exact row.
- **Value tooltips**: hover an ISO or epoch timestamp for local + relative
  time ("Aug 27, 10:47 — 6 days ago"); big integers show thousands-separated.
- **Smart copy**: drag-select across rows and press Cmd/Ctrl+C — you get real
  JSON of the smallest object/array covering the selection, **including parts
  that are still collapsed**. Selecting inside a single row copies plain text
  as usual, so you can still grab one id or token. Selecting never expands or
  collapses a node, and the `▶` glyphs and button labels stay out of the copy.
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
- Host access is **optional and user-granted**; the only default permissions
  are `activeTab`/`scripting` (used when you click the toolbar button),
  `storage` (your site list), and `clipboardWrite` (copy buttons).
- A granted domain is not a place Log Lens runs: the content script re-checks
  every URL against your patterns and does nothing on the ones that don't
  match.

## Development

Plain vanilla JS, zero dependencies, no build step.

```
src/jsontree.js    tree renderer + search + text→segments parser (window.LogLens)
src/jsontree.css   all styles
src/content.js     page detection: full-page raw mode + inline mode + SPA MutationObserver
src/patterns.js    auto-run URL patterns: parse, Chrome-legal grant origin, URL match
src/background.js  registers content scripts for the user's auto-run sites
src/options.*      auto-run site list (patterns + permission requests) + appearance
src/popup.*        toolbar popup (inject / paste viewer / options)
src/standalone.*   paste viewer page
src/devtools.*     devtools bootstrap (registers the panel)
src/devtools-panel.*  the DevTools panel: request list + viewer
tests/             node parser tests + Playwright e2e
```

Run tests:

```bash
node tests/test_segments.js   # pure parser tests, no browser
node tests/test_patterns.js   # URL pattern engine, no browser
node tests/e2e.js             # drives installed Chrome via playwright-core
                              # (set PLAYWRIGHT_CORE to your playwright-core path if needed)
node tests/ext_smoke.js       # loads the unpacked extension (service worker,
                              # options, popup, paste viewer)
```

## Known limits

- "expand all" caps at 25k *expanded containers* on giant payloads; a note
  flashes in the toolbar and the match counter comes back afterwards. Search
  still covers everything because it walks the data, not the DOM.
- Search caps at 2000 matches (shown as `2000+`). **matches only** then keeps
  every match it found, so on a huge log with thousands of matches ticking it
  can block the tab for a moment while it renders each match's path.
- If a JSON block on some viewer isn't auto-detected (exotic markup), use
  the toolbar button — and open an issue with the page structure so an
  adapter can be added.
