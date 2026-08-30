/**
 * Regression tests for the IPFS metadata sanitization hardening.
 *
 * Covers the injection vectors reported against sanitizeMetadata:
 *  - Unicode confusable bypasses (fullwidth "＜script＞", zero-width chars)
 *  - JSON injection via embedded/serialized JSON in metadata strings
 *  - SVG-based XSS in metadata fields (tags and data: URLs)
 *  - CSS injection via <style> blocks, style attributes and CSS constructs
 *  - Encoding tricks (HTML entities, double encoding, whitespace-split schemes)
 *  - Structural abuse (JSON depth bombs)
 *  - Preservation of legitimate metadata
 */
import test from "node:test";
import assert from "node:assert/strict";

process.env.RELAYER_TEST_MODE = "true";

const ipfs = await import("../src/services/ipfs.js");

// Parse a sanitized string that should contain pure JSON and return the doc.
function asJson(str) {
  return JSON.parse(str);
}

// ============================================
// UNICODE CONFUSABLE BYPASSES
// ============================================

test("unicode: fullwidth <script> tags are removed", () => {
  const out = ipfs.sanitizeString("hello ＜script＞alert(1)＜/script＞ world");
  assert.doesNotMatch(out, /script/i);
  assert.match(out, /hello/);
  assert.match(out, /world/);
});

test("unicode: fullwidth letters inside tag names are normalized then removed", () => {
  const out = ipfs.sanitizeString("<scｒipt>alert(1)</scｒipt>");
  assert.doesNotMatch(out, /script/i);
  assert.doesNotMatch(out, /alert/i);
});

test("unicode: fullwidth attribute brackets do not smuggle handlers", () => {
  const out = ipfs.sanitizeString("＜img src=x onerror=alert(1)＞");
  assert.doesNotMatch(out, /onerror/i);
  assert.doesNotMatch(out, /alert/i);
});

test("unicode: zero-width characters splitting tag names are removed", () => {
  const out = ipfs.sanitizeString("<scr​ipt>alert(1)</scr​ipt>");
  assert.doesNotMatch(out, /script/i);
  assert.doesNotMatch(out, /alert/i);
});

test("unicode: unicode-obfuscated __proto__ key is dropped", () => {
  const attack = JSON.parse('{"＿＿proto＿＿":{"polluted":1},"safe":1}');
  const out = ipfs.sanitizeMetadata(attack);
  assert.deepEqual(Object.keys(out), ["safe"]);
  assert.equal(out.safe, 1);
  assert.equal(Object.prototype.polluted, undefined);
});

test("unicode: soft hyphens and null bytes are stripped from values", () => {
  const out = ipfs.sanitizeString("jav­ascript:aler­t(1)");
  assert.doesNotMatch(out, /javascript:/i);
});

// ============================================
// ENCODING BYPASSES
// ============================================

test("encoding: HTML-entity encoded tags are decoded then removed", () => {
  const out = ipfs.sanitizeString("&#60;script&#62;alert(1)&#60;/script&#62;");
  assert.doesNotMatch(out, /script/i);
  assert.doesNotMatch(out, /alert/i);
});

test("encoding: double-encoded entities are unwrapped (bounded)", () => {
  const out = ipfs.sanitizeString("&amp;#60;script&amp;#62;alert(1)");
  assert.doesNotMatch(out, /<script/i);
});

test("encoding: entity-obfuscated javascript: scheme is neutralized", () => {
  const out = ipfs.sanitizeString('<a href="&#106;avascript:alert(1)">x</a>');
  assert.doesNotMatch(out, /javascript:/i);
});

test("encoding: whitespace-split schemes are neutralized", () => {
  const out = ipfs.sanitizeString("java\tscript:alert(1)");
  assert.doesNotMatch(out, /java\tscript:/i);
  const out2 = ipfs.sanitizeString("java\nscript:alert(1)");
  assert.doesNotMatch(out2, /java\nscript:/i);
});

test("encoding: vbscript: and other script schemes are removed", () => {
  assert.doesNotMatch(ipfs.sanitizeString("vbscript:msgbox(1)"), /vbscript:/i);
  assert.doesNotMatch(ipfs.sanitizeString("<a href='vbscript:msgbox(1)'>x</a>"), /vbscript:/i);
});

// ============================================
// NESTED / MALFORMED TAG REASSEMBLY (FIXED POINT)
// ============================================

test("fixed point: nested split tags cannot reassemble", () => {
  const out = ipfs.sanitizeString("<scr<script>ipt>alert(1)</script>");
  assert.doesNotMatch(out, /script/i);
});

test("fixed point: malformed closing tags are removed", () => {
  const out = ipfs.sanitizeString("<script>alert(1)</scri<script>pt>");
  assert.doesNotMatch(out, /<script/i);
  assert.doesNotMatch(out, /<\/script/i);
});

test("fixed point: sanitization is idempotent", () => {
  const dirty =
    "＜script＞＜/script＞<svg onload=alert(1)>'{\"__proto__\":1}'<style>@import \"//evil\";</style>";
  const once = ipfs.sanitizeString(dirty);
  const twice = ipfs.sanitizeString(once);
  assert.equal(twice, once);
});

// ============================================
// SVG-BASED XSS
// ============================================

test("svg: <svg> tags and handlers are removed", () => {
  const out = ipfs.sanitizeString("<svg onload=alert(1)>x</svg>");
  assert.doesNotMatch(out, /<svg/i);
  assert.doesNotMatch(out, /onload/i);
});

test("svg: <math> MathML vector is removed", () => {
  const out = ipfs.sanitizeString('<math><mtext><script>alert(1)</script></mtext></math>');
  assert.doesNotMatch(out, /math|script/i);
});

test("svg: foreignObject vector is removed", () => {
  const out = ipfs.sanitizeString(
    '<svg><foreignObject><body onload=alert(1)></body></foreignObject></svg>',
  );
  assert.doesNotMatch(out, /foreignobject/i);
  assert.doesNotMatch(out, /onload/i);
});

test("svg: data:image/svg+xml URLs are blocked", () => {
  const b64 = "data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+Pg==";
  const out = ipfs.sanitizeString(b64);
  assert.doesNotMatch(out, /data:image\/svg/i);
  assert.match(out, /data:blocked/);

  const raw = ipfs.sanitizeString("data:image/svg+xml,<svg onload=alert(1)>");
  assert.doesNotMatch(raw, /data:image\/svg/i);
  assert.doesNotMatch(raw, /onload/i);
});

test("svg: safe image data: URLs are preserved", () => {
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==";
  const out = ipfs.sanitizeString(png);
  assert.match(out, /data:image\/png;base64/);
});

// ============================================
// CSS INJECTION
// ============================================

test("css: <style> blocks are removed with their content", () => {
  const out = ipfs.sanitizeString('<style>@import "//evil.example/x.css"; body{background:url(javascript:alert(1))}</style>hello');
  assert.doesNotMatch(out, /<style/i);
  assert.doesNotMatch(out, /@import/i);
  assert.match(out, /hello/);
});

test("css: inline style attributes are stripped (quoted/unquoted/backticked)", () => {
  for (const payload of [
    '<div style="width:expression(alert(1))">x</div>',
    "<b style='color:red'>x</b>",
    "<i style=`background:url(http://evil)`>x</i>",
    "<u style=color:red>x</u>",
  ]) {
    assert.doesNotMatch(ipfs.sanitizeString(payload), /style=/i);
  }
});

test("css: expression(), @import, behavior and binding are neutralized", () => {
  assert.doesNotMatch(ipfs.sanitizeString("width:expression(alert(1))"), /expression\s*\(/i);
  assert.doesNotMatch(ipfs.sanitizeString('@import url(evil.css)'), /@import/i);
  assert.doesNotMatch(ipfs.sanitizeString("behavior:url(x.htc)"), /behavior\s*:/i);
  assert.doesNotMatch(ipfs.sanitizeString("-moz-binding:url(x.xml#xss)"), /binding\s*:/i);
});

test("css: url(javascript:) is neutralized", () => {
  const out = ipfs.sanitizeString("background:url(javascript:alert(1))");
  assert.doesNotMatch(out, /javascript:/i);
});

// ============================================
// JSON INJECTION
// ============================================

test("json: __proto__ / constructor / prototype keys are dropped", () => {
  const attack = JSON.parse(
    '{"__proto__":{"polluted":1},"constructor":{"x":1},"prototype":{"y":1},"ok":true}',
  );
  const out = ipfs.sanitizeMetadata(attack);
  assert.deepEqual(Object.keys(out), ["ok"]);
  assert.equal(out.ok, true);
  assert.equal(Object.prototype.polluted, undefined);
  assert.equal(Object.prototype.x, undefined);
  assert.equal(Object.prototype.y, undefined);
});

test("json: __-prefixed keys are dropped at any depth", () => {
  const out = ipfs.sanitizeMetadata({
    a: { "__internal": 1, keep: 2 },
    list: [{ "__danger": 1, keep: 3 }],
  });
  assert.deepEqual(out.a, { keep: 2 });
  assert.deepEqual(out.list, [{ keep: 3 }]);
});

test("json: serialized JSON inside a string field is sanitized and re-serialized", () => {
  const out = ipfs.sanitizeMetadata({
    version: 1,
    body: '{"__proto__":{"polluted":1},"note":"<script>alert(1)</script>hi"}',
  });
  const embedded = asJson(out.body);
  assert.deepEqual(Object.keys(embedded), ["note"]);
  assert.doesNotMatch(embedded.note, /script/i);
  assert.match(embedded.note, /hi/);
  assert.equal(Object.prototype.polluted, undefined);
});

test("json: double-encoded JSON payloads are unwrapped (bounded)", () => {
  const inner = JSON.stringify({ "__proto__": { polluted: 1 }, ok: 1 });
  const outer = JSON.stringify({ note: inner });
  const out = ipfs.sanitizeMetadata({ body: outer });
  const parsedOuter = asJson(out.body);
  const parsedInner = asJson(parsedOuter.note);
  assert.deepEqual(parsedInner, { ok: 1 });
  assert.equal(Object.prototype.polluted, undefined);
});

test("json: unicode-obfuscated keys inside embedded JSON are dropped", () => {
  const out = ipfs.sanitizeMetadata({
    body: '{"＿＿proto＿＿":{"polluted":1},"keep":1}',
  });
  const embedded = asJson(out.body);
  assert.deepEqual(embedded, { keep: 1 });
});

test("json: plain text that merely starts with a brace is left alone", () => {
  const prose = "{what a wonderful proposal} - please vote yes";
  const out = ipfs.sanitizeMetadata({ body: prose });
  assert.equal(out.body, prose);
});

test("json: injected keys do not pollute Object.prototype globally", () => {
  ipfs.sanitizeMetadata(JSON.parse('{"__proto__":{"zkvotePwned":true}}'));
  ipfs.sanitizeMetadata({ body: '{"__proto__":{"zkvotePwned":true}}' });
  assert.equal({}.zkvotePwned, undefined);
});

// ============================================
// STRUCTURAL / DoS HARDENING
// ============================================

test("depth: pathological nesting is truncated, not fatal", () => {
  let obj = { v: "x" };
  for (let i = 0; i < 5000; i++) obj = { a: obj };

  const out = ipfs.sanitizeMetadata(obj);
  let cur = out;
  let depth = 0;
  while (cur && typeof cur === "object" && "a" in cur) {
    cur = cur.a;
    depth++;
  }
  assert.ok(depth <= ipfs.MAX_METADATA_DEPTH + 2);
});

test("depth: metadata at normal depths is fully traversed", () => {
  let obj = { v: "<script>alert(1)</script>deep" };
  for (let i = 0; i < ipfs.MAX_METADATA_DEPTH - 5; i++) obj = { a: obj };

  const out = ipfs.sanitizeMetadata(obj);
  let cur = out;
  while (cur && typeof cur === "object" && "a" in cur) cur = cur.a;
  assert.match(cur.v, /deep/);
  assert.doesNotMatch(cur.v, /script/i);
});

// ============================================
// PRESERVATION OF LEGITIMATE METADATA
// ============================================

test("preservation: proposal-shaped metadata survives intact", () => {
  const benign = {
    version: 1,
    title: "Fund the grant program",
    body: "# Summary\n\n- markdown **kept** [link](https://example.com)\n- totals: 1,000 XLM",
    createdAt: "2026-01-01T00:00:00.000Z",
    videoUrl: "https://www.youtube.com/watch?v=abc123",
    image: {
      cid: "bafybeihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku",
      filename: "cover-image.png",
      mimeType: "image/png",
    },
    tags: ["grants", "q3", "budget-v2"],
    enableComments: true,
    quorum: 51,
    optional: null,
  };
  assert.deepEqual(ipfs.sanitizeMetadata(benign), benign);
});

test("preservation: scalars and non-string values pass through", () => {
  assert.equal(ipfs.sanitizeMetadata(42), 42);
  assert.equal(ipfs.sanitizeMetadata(true), true);
  assert.equal(ipfs.sanitizeMetadata(null), null);
  assert.equal(ipfs.sanitizeString(123), 123);
});

test("preservation: multi-line markdown bodies are untouched", () => {
  const body = [
    "# Proposal",
    "",
    "Line with `code` and > quote",
    "",
    "1. first",
    "2. second",
    "",
    "Tom & Jerry <3 voting - it's great (yes/no)",
  ].join("\n");
  const out = ipfs.sanitizeMetadata({ version: 1, body });
  assert.equal(out.body, body);
});

// ============================================
// END-TO-END SHAPE: ATTACK PAYLOADS ACROSS AN ENTIRE DOCUMENT
// ============================================

test("e2e: a fully hostile metadata document is neutralized", () => {
  const hostile = JSON.parse(`{
    "version": 1,
    "title": "＜script＞alert(1)＜/script＞Legit title",
    "body": "<svg onload=alert(1)>claim<style>@import x;</style>&#106;avascript:alert(1)",
    "image": { "cid": "data:image/svg+xml;base64,PHN2Zz4=", "mimeType": "image/png" },
    "nested": { "deep": { "__proto__": { "polluted": true }, "note": "<scr​ipt>alert(1)</scr​ipt>" } },
    "config": "{\\"__proto__\\":{\\"polluted\\":1},\\"theme\\":\\"<b style=\\"width:expression(alert(1))\\">\\"}"
  }`);

  const out = ipfs.sanitizeMetadata(hostile);
  const ser = JSON.stringify(out);

  assert.doesNotMatch(ser, /<script|＜script/i);
  assert.doesNotMatch(ser, /<svg|onload/i);
  assert.doesNotMatch(ser, /<style|@import/i);
  assert.doesNotMatch(ser, /javascript:|&#106;/i);
  assert.doesNotMatch(ser, /data:image\/svg/i);
  assert.doesNotMatch(ser, /expression\s*\(|style=/i);
  assert.doesNotMatch(ser, /__proto__/i);
  assert.match(ser, /Legit title/);
  assert.equal(out.version, 1);
  assert.equal(out.nested.deep.note.includes("alert"), false);
  assert.deepEqual(JSON.parse(out.config), { theme: "<b>" });
  assert.equal({}.polluted, undefined);
});
