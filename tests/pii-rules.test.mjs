import test from "node:test";
import assert from "node:assert/strict";
import { detectPII, verhoeffValid, luhnValid } from "../client/lib/pii-rules.mjs";

test("verhoeff validates a known-good Aadhaar and rejects a bad one", () => {
  // 234567890124 has a valid Verhoeff check digit
  assert.equal(verhoeffValid("234567890124"), true);
  assert.equal(verhoeffValid("234567890123"), false);
  assert.equal(verhoeffValid("1234"), false);
});

test("luhn validates card numbers", () => {
  assert.equal(luhnValid("4111 1111 1111 1111"), true);
  assert.equal(luhnValid("4111111111111112"), false);
});

test("detects PAN, email and a Verhoeff-valid Aadhaar in free text", () => {
  const text = "Name ABCPS1234K, mail me at a.b@example.co.in, uid 2345 6789 0124 ok";
  const cats = detectPII(text).map((h) => h.category).sort();
  assert.deepEqual(cats, ["aadhaar", "email", "pan"]);
});

test("does not flag a checksum-failing 12-digit number as Aadhaar", () => {
  const hits = detectPII("order number 2345 6789 0123 shipped");
  assert.equal(hits.find((h) => h.category === "aadhaar"), undefined);
});

test("overlapping matches are de-duplicated", () => {
  const hits = detectPII("4111 1111 1111 1111");
  // card pattern and phone-ish digits could both fire; only one survives per span
  const spans = hits.map((h) => `${h.start}-${h.end}`);
  assert.equal(new Set(spans).size, spans.length);
});

test("returns [] for empty / non-string", () => {
  assert.deepEqual(detectPII(""), []);
  assert.deepEqual(detectPII(null), []);
});
