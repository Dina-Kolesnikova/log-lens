/* Log Lens — auto-run URL pattern engine.
 *
 * Auto-run patterns are OUR syntax, not Chrome's: a wildcard may sit anywhere
 * in the host (`stg*-logs.example.com`, `*-staging.example.com`). Chrome's
 * match-pattern grammar cannot express that — a host is only `*`,
 * `*.domain.tld` or a literal — so permissions.request() and
 * registerContentScripts() would both reject such a pattern.
 *
 * So each pattern is used twice, differently:
 *   toGrantOrigin(p)  -> narrowest CHROME-LEGAL SUPERSET; what we ask
 *                        permission for and register the content script on
 *   matchesUrl(p, u)  -> the real filter, applied locally in the content
 *                        script, narrowing the superset back to what was typed
 *
 * Loads in four contexts: service worker (importScripts), content script,
 * options page (<script>), node tests (module.exports).
 */
(function (root) {
  'use strict';

  const SCHEMES = ['*', 'http', 'https', 'file'];
  const MAX_PATTERN = 2000; // user-authored; a huge one is a mistake, not input
  const MAX_HOST = 253;     // DNS limit

  function esc(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /* Add the parts a user usually leaves off: scheme and a path. */
  function normalizeInput(raw) {
    if (typeof raw !== 'string') return '';
    let p = raw.trim();
    if (!p) return '';
    if (!/^[a-z*]+:\/\//i.test(p)) p = 'https://' + p;
    const rest = p.slice(p.indexOf('://') + 3);
    if (rest.indexOf('/') < 0) p += '/*';
    return p;
  }

  /* Structural validity in OUR syntax — wildcards anywhere in the host are
   * fine here. Returns null when there is nothing sane to work with. */
  function parse(p) {
    if (typeof p !== 'string' || !p || p.length > MAX_PATTERN) return null;
    const i = p.indexOf('://');
    if (i < 0) return null;
    const scheme = p.slice(0, i).toLowerCase();
    if (SCHEMES.indexOf(scheme) < 0) return null;
    const rest = p.slice(i + 3);
    const j = rest.indexOf('/');
    if (j < 0) return null; // no path component
    const host = rest.slice(0, j).toLowerCase();
    const path = rest.slice(j);
    if (scheme === 'file') return host ? null : { scheme, host: '', path };
    if (!host || host.length > MAX_HOST) return null;
    // no ports, no credentials, no regex metacharacters
    if (!/^[a-z0-9*._-]+$/.test(host)) return null;
    if (host.indexOf('..') >= 0 || host[0] === '.' || host[host.length - 1] === '.') return null;
    // a wildcard-free host needs a dot to be a host at all ("42", "logs")
    if (host.indexOf('*') < 0 && host.indexOf('.') < 0 && host !== 'localhost') return null;
    return { scheme, host, path };
  }

  function hostIsChromeLegal(host) {
    if (host === '*') return true;
    const h = host.slice(0, 2) === '*.' ? host.slice(2) : host;
    return !!h && h.indexOf('*') < 0;
  }

  /* True when Chrome would accept the pattern as-is. */
  function isChromePattern(p) {
    const q = parse(normalizeInput(p));
    if (!q) return false;
    return q.scheme === 'file' ? true : hostIsChromeLegal(q.host);
  }

  /* Narrowest Chrome-legal origin that still contains every URL the pattern
   * can match: drop every host label up to and including the last one holding
   * a wildcard, then prefix `*.`. Path widens to /* — Chrome grants per
   * origin, and matchesUrl() enforces the real path. */
  function toGrantOrigin(p) {
    const q = parse(normalizeInput(p));
    if (!q) return null;
    if (q.scheme === 'file') return 'file:///*';
    let host = q.host;
    if (!hostIsChromeLegal(host)) {
      const labels = host.split('.');
      let last = -1;
      for (let i = 0; i < labels.length; i++) {
        if (labels[i].indexOf('*') >= 0) last = i;
      }
      const kept = labels.slice(last + 1);
      host = kept.length ? '*.' + kept.join('.') : '*';
    }
    return q.scheme + '://' + host + '/*';
  }

  /* The grant would cover a whole TLD (or every host) — worth warning about
   * before Chrome shows its own prompt. */
  function grantIsTldWide(p) {
    const origin = toGrantOrigin(p);
    if (!origin) return false;
    const q = parse(origin);
    if (!q || q.scheme === 'file') return false;
    if (q.host === '*') return true;
    if (q.host.indexOf('*') < 0) return false;
    return q.host.slice(2).split('.').length < 2;
  }

  /* A `*` inside a label stays inside it: `*-staging.example.com` matches
   * `stg29-staging.example.com` but not `a.b-staging.example.com`. */
  function labelRe(label) {
    return label.split('*').map(esc).join('[^.]*');
  }

  function hostRe(host) {
    if (host === '*') return /^.*$/;
    if (host.slice(0, 2) === '*.') {
      const rest = host.slice(2);
      // Chrome semantics: `*.example.com` matches example.com AND subdomains
      const tail = rest.indexOf('*') >= 0
        ? rest.split('.').map(labelRe).join('\\.')
        : esc(rest);
      return new RegExp('^(?:[^.]+\\.)*' + tail + '$');
    }
    return new RegExp('^' + host.split('.').map(labelRe).join('\\.') + '$');
  }

  /* In the path, `*` crosses `/` — same as Chrome. */
  function pathRe(path) {
    return new RegExp('^' + path.split('*').map(esc).join('.*') + '$');
  }

  /* The real auto-run gate. */
  function matchesUrl(pattern, url) {
    const q = parse(normalizeInput(pattern));
    if (!q) return false;
    let u;
    try { u = new URL(url); } catch (e) { return false; }
    const scheme = u.protocol.replace(/:$/, '').toLowerCase();
    if (q.scheme === '*') {
      if (scheme !== 'http' && scheme !== 'https') return false;
    } else if (q.scheme !== scheme) {
      return false;
    }
    if (scheme === 'file') {
      if (u.hostname) return false;
    } else if (!hostRe(q.host).test(u.hostname.toLowerCase())) {
      return false;
    }
    // Chrome compares the pattern path against path + query, never the hash
    return pathRe(q.path).test(u.pathname + u.search);
  }

  /* True when the path can only ever match one exact URL — the options page
   * nudges the user to add a trailing `*`. */
  function pathIsExact(p) {
    const q = parse(normalizeInput(p));
    return !!q && q.path.indexOf('*') < 0;
  }

  const api = {
    normalizeInput,
    parse,
    isChromePattern,
    toGrantOrigin,
    grantIsTldWide,
    matchesUrl,
    pathIsExact,
  };
  root.LLPatterns = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self);
