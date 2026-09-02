const P = require(__dirname + '/../src/patterns.js');

let pass = 0, fail = 0;
function t(name, cond) { if (cond) { pass++; } else { fail++; console.error('FAIL: ' + name); } }
function eq(name, got, want) { t(name + ' (got ' + JSON.stringify(got) + ')', got === want); }

/* ---------- mid-host wildcards: the case Chrome cannot express ---------- */

const STG = 'https://*-staging.example.com/log-viewer/*';
eq('mid-host: not a Chrome pattern', P.isChromePattern(STG), false);
eq('mid-host: grant widens to the domain', P.toGrantOrigin(STG), 'https://*.example.com/*');
t('mid-host: matches the staging host',
  P.matchesUrl(STG, 'https://stg7-staging.example.com/log-viewer/log-123'));
t('mid-host: matches another staging host',
  P.matchesUrl(STG, 'https://stg1-staging.example.com/log-viewer/log-abc?raw=1'));
t('mid-host: rejects a sibling host in the granted domain',
  !P.matchesUrl(STG, 'https://www.example.com/log-viewer/log-123'));
t('mid-host: rejects another path on a matching host',
  !P.matchesUrl(STG, 'https://stg7-staging.example.com/dashboard'));
t('mid-host: label wildcard does not cross a dot',
  !P.matchesUrl(STG, 'https://a.b-staging.example.com/log-viewer/x'));
t('mid-host: rejects a lookalike domain',
  !P.matchesUrl(STG, 'https://stg7-staging.example.com.evil.test/log-viewer/x'));

eq('wildcard in a middle label widens past it',
  P.toGrantOrigin('https://foo.*.example.com/*'), 'https://*.example.com/*');
eq('single wildcard label widens to every host',
  P.toGrantOrigin('https://stg*/logs/*'), 'https://*/*');

/* ---------- documented patterns keep working ---------- */

const LEGAL = [
  ['https://logs.example.com/*', 'https://logs.example.com/*'],
  ['*://*.example.com/*', '*://*.example.com/*'],
  ['*://*/*', '*://*/*'],
  ['https://logs.example.com/api/*', 'https://logs.example.com/*'],
];
for (const [p, grant] of LEGAL) {
  t('legal: ' + p + ' is a Chrome pattern', P.isChromePattern(p));
  eq('legal: ' + p + ' grant', P.toGrantOrigin(p), grant);
}
t('file pattern parses', P.isChromePattern('file:///Users/me/logs/*'));
eq('file grant', P.toGrantOrigin('file:///Users/me/logs/*'), 'file:///*');
t('file matches', P.matchesUrl('file:///Users/me/logs/*', 'file:///Users/me/logs/a.json'));
t('file does not match http', !P.matchesUrl('file:///Users/me/logs/*', 'https://x.example.com/a.json'));

t('*.example.com matches the bare domain', P.matchesUrl('*://*.example.com/*', 'https://example.com/x'));
t('*.example.com matches a deep subdomain', P.matchesUrl('*://*.example.com/*', 'http://a.b.example.com/x'));
t('*.example.com rejects a suffix lookalike', !P.matchesUrl('*://*.example.com/*', 'https://notexample.com/x'));
t('*:// does not match file', !P.matchesUrl('*://*/*', 'file:///tmp/a.json'));
t('*://*/* matches anything http(s) — the "always on" entry',
  P.matchesUrl('*://*/*', 'https://anything.test/a/b?c=1'));
t('exact path matches only itself', P.matchesUrl('https://logs.example.com/api', 'https://logs.example.com/api'));
t('exact path rejects a child path', !P.matchesUrl('https://logs.example.com/api', 'https://logs.example.com/api/v2'));
t('path * crosses slashes', P.matchesUrl('https://logs.example.com/a/*', 'https://logs.example.com/a/b/c'));
t('path match ignores the hash', P.matchesUrl('https://logs.example.com/a', 'https://logs.example.com/a#frag'));
t('scheme is enforced', !P.matchesUrl('https://logs.example.com/*', 'http://logs.example.com/x'));

/* ---------- normalizeInput ---------- */

eq('bare host gets scheme and path', P.normalizeInput('logs.example.com'), 'https://logs.example.com/*');
eq('host with path is left alone', P.normalizeInput('logs.example.com/api'), 'https://logs.example.com/api');
eq('scheme kept, path added', P.normalizeInput('http://logs.example.com'), 'http://logs.example.com/*');
eq('wildcard scheme kept', P.normalizeInput('*://*.example.com/*'), '*://*.example.com/*');
eq('file url untouched', P.normalizeInput('file:///tmp/a/*'), 'file:///tmp/a/*');
eq('surrounding space trimmed', P.normalizeInput('  logs.example.com  '), 'https://logs.example.com/*');
eq('empty stays empty', P.normalizeInput(''), '');
t('pathIsExact flags a wildcard-less path', P.pathIsExact('https://logs.example.com/api/v2'));
t('pathIsExact false with a wildcard', !P.pathIsExact('https://logs.example.com/api/*'));

/* ---------- overly broad grants ---------- */

t('tld-wide: *-logs.*.com', P.grantIsTldWide('https://*-logs.*.com/*'));
t('tld-wide: *.com', P.grantIsTldWide('https://*.com/*'));
t('tld-wide: every host', P.grantIsTldWide('*://*/*'));
t('tld-wide: single wildcard label', P.grantIsTldWide('https://stg*/logs/*'));
t('not tld-wide: *.example.com', !P.grantIsTldWide('*://*.example.com/*'));
t('not tld-wide: literal host', !P.grantIsTldWide('https://logs.example.com/*'));
t('not tld-wide: file', !P.grantIsTldWide('file:///tmp/*'));

/* ---------- hostile / malformed input: never throw, never over-match ---------- */

// bare `*` is the documented all-sites shorthand, not junk — the options page
// still shows the derived grant and the tld-wide warning before Chrome asks
eq('bare * is the all-sites shorthand', P.toGrantOrigin('*'), 'https://*/*');
t('bare * warns as tld-wide', P.grantIsTldWide('*'));

const JUNK = ['', '.', '://', 'https://', 'https:///', 'ftp://x.example.com/*',
  'https://a+b.example.com/*', 'https://user:pw@x.example.com/*', 'https://x.example.com:8080/*',
  'https://..example.com/*', 'https://.example.com/*', 'https://example.com./*',
  null, undefined, 42, {}, [], 'https://' + 'a'.repeat(2000) + '.example.com/*'];
for (const j of JUNK) {
  const label = JSON.stringify(j) === undefined ? String(j) : JSON.stringify(j);
  let threw = false, m = null, g = null;
  try { m = P.matchesUrl(j, 'https://logs.example.com/x'); g = P.toGrantOrigin(j); }
  catch (e) { threw = true; }
  t('junk ' + label + ': does not throw', !threw);
  t('junk ' + label + ': does not match', m === false);
  t('junk ' + label + ': no grant origin', g === null);
}
t('a url that is not a url does not match', P.matchesUrl('*://*/*', 'not a url') === false);
t('regex metacharacters in a legal host stay literal',
  !P.matchesUrl('https://a-b.example.com/*', 'https://axb.example.com/x'));

console.log((fail ? 'FAIL' : 'PASS') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
