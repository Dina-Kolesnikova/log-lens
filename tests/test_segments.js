const fs = require('fs');
const vm = require('vm');
const ctx = { window: {}, document: undefined, navigator: {}, setTimeout, console };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(__dirname + '/../src/jsontree.js', 'utf8'), ctx);
const LL = ctx.window.LogLens;
if (!LL) { console.error('FAIL: LogLens not exported'); process.exit(1); }

let pass = 0, fail = 0;
function t(name, cond) { if (cond) { pass++; } else { fail++; console.error('FAIL: ' + name); } }

// 1. pure JSON doc
let s = LL.extractSegments('  {"a": 1, "b": [1,2,3]}  ');
t('pure json -> 1 json seg', s.length === 1 && s[0].type === 'json' && s[0].value.a === 1);

// 2. log-raw style: preamble line + labelled JSON block
const logRaw = `6a95c28e6efa0fe79807b06d - error - GET https://logs.example.com/api/v2/location-details - 2026-08-31T14:06:06-04:00 (20 hours ago)

composite as string.json [542] Request headers
{
    "Host": [
        "logs.example.com"
    ],
    "User-Agent": [
        "OpenAPI-Generator/1.0.0/PHP"
    ]
}`;
s = LL.extractSegments(logRaw);
t('log-raw -> text + json', s.some(x => x.type === 'text') && s.some(x => x.type === 'json'));
const j = s.find(x => x.type === 'json');
t('log-raw json parsed', j && j.value.Host[0] === 'logs.example.com');

// 3. single-line S3-proxy style with nested braces and stars
const s3 = '{"TimeOut":"00:00:30","Headers":{"Authorization":"***","Customer-Session-Id":"***"},"URL":"https://api.example.com/v3/properties/888734/reviews?language=en-US","DataToLog":{"calltype":"ProviderGetReviewRequest","providerId":"ACME"},"MiddleWares":[{},{}],"AdditionalData":{},"PreferProtobufResponse":false}';
s = LL.extractSegments(s3);
t('s3proxy single-line json', s.length === 1 && s[0].type === 'json' && s[0].value.DataToLog.providerId === 'ACME');

// 4. multiple JSON blocks separated by text
s = LL.extractSegments('Request headers\n{"a":1}\nResponse body\n{"b":{"c":[1,2]}}\ntrailer');
t('multi-block segments', s.filter(x => x.type === 'json').length === 2 && s.filter(x => x.type === 'text').length === 3);

// 5. braces inside strings must not break scanning
s = LL.extractSegments('prefix {"msg":"has } and { inside","esc":"quote \\" here"} suffix');
t('braces in strings', s.filter(x => x.type === 'json').length === 1 && s.find(x=>x.type==='json').value.msg.includes('}'));

// 6. text with no JSON
s = LL.extractSegments('just a plain log line without structures');
t('no json -> text only', s.length === 1 && s[0].type === 'text');

// 7. invalid JSON-looking block (single quotes) is not treated as JSON
s = LL.extractSegments("{'a': 1}");
t('invalid json stays text', !s.some(x => x.type === 'json'));

// 8. JSON-in-string detection reachability via search-like parse (nested)
const nested = { data: JSON.stringify({ inner: { deep: 'needle' } }) };
s = LL.extractSegments(JSON.stringify(nested));
t('nested stays string at segment level', s[0].type === 'json' && typeof s[0].value.data === 'string');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
