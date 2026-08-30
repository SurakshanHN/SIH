import test from "node:test";
import assert from "node:assert/strict";
import { validateAction, validatePlan } from "../client/lib/agent-client.mjs";

const ids = new Set(["el-1", "el-2", "submit-1"]);
const tokens = new Set(["[AADHAAR_1]", "[EMAIL_1]"]);

test("accepts a well-formed type action", () => {
  assert.equal(validateAction({ action: "type", targetId: "el-1", valueToken: "[EMAIL_1]" }, ids, tokens), null);
});

test("rejects unknown action / target / token", () => {
  assert.match(validateAction({ action: "frobnicate" }, ids, tokens), /unknown action/);
  assert.match(validateAction({ action: "click", targetId: "nope" }, ids, tokens), /unknown targetId/);
  assert.match(validateAction({ action: "type", targetId: "el-1", valueToken: "[SSN_9]" }, ids, tokens), /unknown valueToken/);
});

test("rejects type without any value", () => {
  assert.match(validateAction({ action: "type", targetId: "el-1" }, ids, tokens), /needs valueToken or literalValue/);
});

test("validatePlan stops at first 'done' and rejects the whole plan on a bad action", () => {
  const good = validatePlan(
    [{ action: "type", targetId: "el-1", valueToken: "[EMAIL_1]" }, { action: "done" }, { action: "click", targetId: "x" }],
    ids, tokens
  );
  assert.equal(good.ok, true);
  assert.equal(good.actions.length, 2);

  const bad = validatePlan([{ action: "click", targetId: "ghost" }], ids, tokens);
  assert.equal(bad.ok, false);
});
