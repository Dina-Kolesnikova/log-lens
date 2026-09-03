# ⌕ Log Lens — User Guide

Log Lens is a Chrome extension that turns walls of raw JSON — log pages, API
responses, debug dumps — into an interactive tree you can search, filter,
copy from, and share links into. Everything happens locally inside your
browser: **no data ever leaves the page**, no network requests, no analytics.

This guide covers every feature. Skim the headings — each section starts
with *when you'd want this*.

---

## 1. Install

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top-right toggle)
3. Click **Load unpacked** and select the Log Lens folder
4. Pin "Log Lens" to the toolbar (puzzle-piece icon → pin)

After an update: come back to `chrome://extensions`, hit the ↻ reload icon on
the Log Lens card, and **reopen** any log tabs (an open tab keeps running the
old version until reloaded).

---

## 2. Three ways to run it

### a) Automatically, on your log sites (recommended)
Toolbar icon → **Auto-run sites…** (the options page). Add URL patterns for
the pages you read logs on. From then on, those pages open already enhanced.

A pattern is `scheme://host/path`, and `*` is a wildcard **anywhere**:

```
https://logs.example.com/*                   one host
*://*.example.com/*                          a domain and all subdomains
https://*-staging.example.com/log-viewer/*   wildcard inside the host name
file:///Users/me/logs/*                      local files
```

Tips:
- End the path with `*` — a pattern without it matches one exact URL only
  (the page warns you about this).
- Chrome can only *grant permission* per domain, so a pattern with a wildcard
  inside the host is granted one level wider — the line under the input always
  shows exactly what Chrome will ask for **before** it asks. Log Lens still
  auto-runs only on URLs matching the pattern you typed, never the whole
  granted domain.
- Want it everywhere? Tick **Auto-run on every site** — one permission prompt,
  no patterns to maintain. Log Lens still only activates on pages that
  actually contain JSON; normal websites are untouched.
- If a site row shows *"not auto-running — permission missing"* (e.g. you
  revoked it in `chrome://extensions`), click its **grant** button.

### b) Manually, on any page
Toolbar icon → **Enhance this page**. Works on any page containing JSON,
regardless of your auto-run list.

### c) The paste viewer
Toolbar icon → **Open paste viewer** → paste any log text → **Render**.
Accepts pure JSON or mixed text (log preamble + JSON blocks). Use it for logs
copied from terminals, tickets, chat messages.

### Turning it off
Every viewer's toolbar has an **off** button that restores the original page.
While off, a small draggable **"⌕ Log Lens OFF"** pill floats on the page —
click it to switch back on. OFF is remembered **only for the current tab**;
new tabs and sessions always start enhanced. The toolbar popup has the same
per-tab switch.

---

## 3. Reading the tree

- Click a **key name**, the **▸ arrow**, or the **`{ 4 fields }` preview** to
  expand/collapse that node.
- **Depth buttons** in the toolbar: `1` `2` `3` open the whole document to
  that depth in one click; `all` expands everything; `−` collapses everything.
- Huge arrays render in batches of 200 with a **"show N more"** button —
  nothing freezes, even on multi-megabyte payloads.
- **`str→json` badge**: a string value that *contains* JSON (very common in
  logs — stringified request bodies, session data) is parsed and shown as a
  real subtree. `copy` still copies the original string; `copy parsed` copies
  the parsed JSON.
- **raw** button (toolbar) toggles back to the untouched original text at any
  time. **copy JSON** copies the whole document, pretty-printed.

Caps to know about: `all` stops after 25 000 expanded containers on giant
payloads (a note flashes in the toolbar, then your search counter returns).
Search and pins are NOT affected by this — they read the data itself, not
what's on screen.

---

## 4. Search

Type in the toolbar search box. Search matches **keys and values**, including
inside **collapsed** nodes and inside parsed JSON-strings — it walks the data,
not the screen.

- **Enter** = next match, **Shift+Enter** = previous (or the ‹ › buttons).
  The counter shows `3 / 41`.
- Matches cap at 2000, shown as `2000+`.

### Matches only
Tick **matches only** to hide everything except the matches and their parent
chain. Great for questions like "show me every `cancellation` in this log."

While the filter is on, the depth buttons work *inside your matches*:
`all` fully expands **every matched subtree** (not the hidden rest of the
document), `1 2 3` open N levels under each match, `−` collapses within them.
Untick to get the full document back — unrelated parts stay as they were.

Heads-up: on a huge log with thousands of matches, ticking the box can pause
the tab for a moment while every match is rendered.

---

## 5. Pins — your fields, always on top

*For when you open similar logs all day and always look up the same 5–6
fields.*

- Hover any row → click **pin**. The key joins the **watch strip** — a row of
  chips between the toolbar and the tree.
- Each chip shows: the **key name** · **how many times it occurs** (`30✕`) ·
  the **first value**.
- **Click a chip** to jump to the first occurrence; click again (or **›**) for
  the next, **‹** for the previous — wrapping at the ends. The chip counts
  `1/30`, `2/30`, … and its value updates to the occurrence you're on, so
  stepping through reads like a ticker. Each jump highlights and scrolls to
  the row.
- **✕** on the chip unpins. A pinned key that doesn't exist in the current
  log shows dimmed as `—` — harmless, so your pins can stay on across
  different kinds of pages.
- Pins are saved to your Chrome profile and **sync across your machines**.
  They apply on every page Log Lens enhances — pin once, see everywhere.

---

## 6. Row actions (hover any row)

| Button | What it does |
|---|---|
| `copy` | Copy this value (on scalars) |
| `copy JSON` | Copy this whole object/array, pretty-printed (on containers) |
| `copy parsed` | On `str→json` rows: copy the *parsed* JSON instead of the raw string |
| `path` | Copy the row's address, e.g. `$.rooms[0].price.total` |
| `copy table` | On arrays of similar objects: copy a paste-ready table (see §7) |
| `pin` | Add/remove this key in the watch strip (see §5) |
| `🔗` | Copy a link that opens this page *at this exact row* (see §8) |

---

## 7. Copy as table

*For evidence tables in bug reports and quick spreadsheet analysis.*

On any array of two or more similar objects (a list of rooms, rates, orders…),
hover the array's row → **copy table**. The clipboard gets a tab-separated
table:

```
id    name    price.total    price.currency    tags
1     King    1108.93        CAD               [ 2 items ]
2     Twin    989.1          CAD               [ 1 item ]
3     Suite   2000           USD               [ 0 items ]
```

- Columns are the union of the items' fields; nested values get dot-names
  (`price.total`); anything deeper than two levels (or an array) shows as its
  preview.
- Paste directly into Google Sheets, Excel, Jira, or a TSV file — it lands as
  a real table.

---

## 8. Row links — share the exact spot

*For "look at THIS field" messages to teammates.*

Hover a row → **🔗** copies the page URL with the row's address attached
(`…#ll=$.rooms[0].price.total`). Anyone opening that link (with Log Lens
installed) lands on the page with that row already rendered, highlighted, and
scrolled into view — no "scroll down to the third room, then…" instructions.

---

## 9. Smart copy (text selection)

- Selecting text **within one row** and copying works exactly like normal —
  grab an id or a token as usual.
- Selecting **across several rows** and pressing Cmd/Ctrl+C copies **real
  JSON** of the smallest object/array covering your selection — *including
  parts that are still collapsed*. The ▸ arrows and button labels never
  pollute the copy.
- Selecting never expands or collapses nodes — select freely.

---

## 10. Tooltips

Hover a value:
- ISO timestamps (`2026-08-27T14:47:44Z`) and 10/13-digit epoch numbers show
  **your local time plus relative time** — "Aug 27, 10:47 — 6 days ago".
- Large integers show thousands-separated: `123,456`.

---

## 11. Appearance

Options page → **Appearance**: color pickers for accent/buttons, font color,
keys, strings, numbers, booleans, backgrounds, plus font size — with a live
preview. Changes apply instantly to every open Log Lens view and sync with
your Chrome profile. **reset to defaults** restores the stock look.

---

## 12. Privacy

- No analytics, no remote requests, no data collection — the entire extension
  runs inside your browser tab.
- Host access is optional and user-granted; the only default permissions are
  `activeTab`/`scripting` (the toolbar button), `storage` (your site list,
  pins, theme), and `clipboardWrite` (the copy buttons).
- A granted domain is not a place Log Lens runs: it re-checks every URL
  against your patterns and does nothing on pages that don't match.

---

## 13. Troubleshooting

| Symptom | Fix |
|---|---|
| A JSON block on some page isn't detected | Toolbar → **Enhance this page**; if it's a viewer you use daily, open an issue with the page structure |
| Auto-run stopped on a site | Options page — the row will say *"permission missing"*; click **grant** |
| New version doesn't behave differently | Reload the extension at `chrome://extensions` AND reopen the log tab |
| "expanded first 25000 nodes" note | You hit the expand-all cap on a giant payload — search/pins still see everything; use **matches only** + `all` to fully expand just what you care about |
| Page is slow after ticking matches-only | Thousands of matches are being rendered; narrow the search first |
| The OFF pill is in the way | Drag it anywhere; it only exists while Log Lens is off on that tab |
