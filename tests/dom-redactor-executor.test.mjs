import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sensitiveFieldsCode = fs.readFileSync(path.join(__dirname, "../client/lib/sensitive-fields.js"), "utf8");
const redactorCode = fs.readFileSync(path.join(__dirname, "../client/dom-redactor.js"), "utf8");
const executorCode = fs.readFileSync(path.join(__dirname, "../client/executor.js"), "utf8");

// Minimal DOM mock sufficient to test TreeWalker + MutationObserver + Executor
class MockNode {
  constructor(nodeType, nodeValue = null) {
    this.nodeType = nodeType;
    this.nodeValue = nodeValue;
    this.parentElement = null;
    this.childNodes = [];
    this.attributes = {};
    this._listeners = {};
  }
  get isConnected() { return true; }
  get textContent() {
    if (this.nodeType === 3) return this.nodeValue;
    return this.childNodes.map(c => c.textContent).join("");
  }
  set textContent(val) {
    if (this.nodeType === 3) {
      this.nodeValue = val;
    } else {
      this.childNodes = [new MockNode(3, String(val))];
      this.childNodes[0].parentElement = this;
    }
  }
  appendChild(child) {
    child.parentElement = this;
    this.childNodes.push(child);
    return child;
  }
  getAttribute(name) { return this.attributes[name] || null; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  hasAttribute(name) { return name in this.attributes; }
  removeAttribute(name) { delete this.attributes[name]; }
  addEventListener(evt, fn) {
    this._listeners[evt] = this._listeners[evt] || [];
    this._listeners[evt].push(fn);
  }
  dispatchEvent(event) {
    const list = this._listeners[event.type] || [];
    for (const fn of list) fn(event);
    return true;
  }
  closest(selector) {
    const tags = selector.toUpperCase().split(/,\s*/);
    let cur = this;
    while (cur) {
      if (cur.tagName && tags.includes(cur.tagName)) return cur;
      cur = cur.parentElement;
    }
    return null;
  }
}

class MockElement extends MockNode {
  constructor(tagName) {
    super(1);
    this.tagName = tagName.toUpperCase();
    this.value = "";
    this.options = [];
  }
  focus() {}
  blur() {}
  scrollIntoView() {}
}

class MockDocument {
  constructor() {
    this.body = new MockElement("BODY");
  }
  createElement(tag) { return new MockElement(tag); }
  createTextNode(text) { return new MockNode(3, text); }
  createTreeWalker(root, whatToShow, filter) {
    const nodes = [];
    function collect(n) {
      if (n.nodeType === 3) {
        if (!filter || filter.acceptNode(n) === 1) nodes.push(n);
      }
      for (const c of n.childNodes) collect(c);
    }
    collect(root);
    let idx = 0;
    return {
      nextNode() {
        return idx < nodes.length ? nodes[idx++] : null;
      }
    };
  }
  querySelector(sel) {
    // Basic [data-pl-id="..."] selector support
    const m = sel.match(/\[data-pl-id="([^"]+)"\]/);
    if (m) {
      const targetId = m[1];
      function find(node) {
        if (node.getAttribute?.("data-pl-id") === targetId) return node;
        for (const c of node.childNodes || []) {
          const found = find(c);
          if (found) return found;
        }
        return null;
      }
      return find(this.body);
    }
    return null;
  }
}

function setupContext() {
  const document = new MockDocument();
  const window = {
    document,
    Node: { ELEMENT_NODE: 1, TEXT_NODE: 3 },
    NodeFilter: { SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2 },
    Event: class { constructor(type) { this.type = type; } },
    KeyboardEvent: class { constructor(type) { this.type = type; } },
    InputEvent: class { constructor(type) { this.type = type; } },
    MutationObserver: class {
      constructor(cb) { this.cb = cb; }
      observe() {}
      disconnect() {}
    },
    CSS: { escape: (s) => s },
    chrome: {
      runtime: {
        onMessage: { addListener: () => {} },
        sendMessage: () => {}
      }
    },
    HTMLTextAreaElement: class {},
    HTMLSelectElement: MockElement,
    HTMLInputElement: MockElement,
    __PL: {},
  };

  // Load the shared sensitive-fields module first (mirrors manifest.json load order)
  const fnSensitive = new Function("window", sensitiveFieldsCode);
  fnSensitive(window);

  const fnRedactor = new Function("window", "document", "Node", "NodeFilter", "MutationObserver", "chrome", redactorCode);
  fnRedactor(window, document, window.Node, window.NodeFilter, window.MutationObserver, window.chrome);

  const fnExecutor = new Function("window", "document", "CSS", "Event", "KeyboardEvent", "InputEvent", "HTMLTextAreaElement", "HTMLSelectElement", "HTMLInputElement", executorCode);
  fnExecutor(window, document, window.CSS, window.Event, window.KeyboardEvent, window.InputEvent, window.HTMLTextAreaElement, window.HTMLSelectElement, window.HTMLInputElement);

  return { window, document, __PL: window.__PL };
}

test("DOM Redactor - scans and redacts text nodes with solid black boxes", () => {
  const { document, __PL } = setupContext();

  const p1 = document.createElement("P");
  const tn1 = document.createTextNode("Aadhaar: 2345 6789 0124 and PAN ABCDE1234F verified.");
  p1.appendChild(tn1);
  document.body.appendChild(p1);

  const p2 = document.createElement("P");
  const tn2 = document.createTextNode("Phone: +91 9876543210, SSN: 123-45-6789, Card: 4111 1111 1111 1111, Email: test@privacylens.local");
  p2.appendChild(tn2);
  document.body.appendChild(p2);

  const count = __PL.redactTextNodes(document.body);
  assert.equal(count, 2);

  assert.equal(tn1.nodeValue, "Aadhaar: ████████████ and PAN ██████████ verified.");
  assert.equal(tn2.nodeValue, "Phone: ██████████, SSN: ███████████, Card: ████████████████, Email: ████████████████");
});

test("Executor - handles <select> dropdown by selecting index 1 and firing events", async () => {
  const { document, __PL } = setupContext();

  const select = document.createElement("SELECT");
  select.setAttribute("data-pl-id", "state-sel");
  select.options = [
    { value: "", textContent: "-- Select State --" },
    { value: "KA", textContent: "Karnataka" },
    { value: "MH", textContent: "Maharashtra" }
  ];
  document.body.appendChild(select);

  let inputFired = false;
  let changeFired = false;
  select.addEventListener("input", () => { inputFired = true; });
  select.addEventListener("change", () => { changeFired = true; });

  const res = await __PL.executeAction({ action: "select", targetId: "state-sel" }, null);
  assert.equal(res.ok, true);
  assert.equal(select.value, "KA");
  assert.equal(inputFired, true);
  assert.equal(changeFired, true);
});

test("Executor - handles <select> fuzzy matching with preference", async () => {
  const { document, __PL } = setupContext();

  const select = document.createElement("SELECT");
  select.setAttribute("data-pl-id", "state-sel");
  select.options = [
    { value: "", textContent: "-- Select State --" },
    { value: "KA", textContent: "Karnataka" },
    { value: "MH", textContent: "Maharashtra" }
  ];
  document.body.appendChild(select);

  const res = await __PL.executeAction({ action: "select", targetId: "state-sel" }, "Maharashtra");
  assert.equal(res.ok, true);
  assert.equal(select.value, "MH");
});

test("Executor - directly types resolved value into non-sensitive input field", async () => {
  const { document, __PL } = setupContext();

  const input = document.createElement("INPUT");
  input.setAttribute("data-pl-id", "search-field");
  document.body.appendChild(input);

  await __PL.executeAction({ action: "type", targetId: "search-field" }, "laptop stand");
  assert.equal(input.value, "laptop stand");
});

test("Executor - coerces free-text dates to yyyy-MM-dd for <input type=date>", async () => {
  const { document, __PL } = setupContext();

  const mk = (id) => {
    const el = document.createElement("INPUT");
    el.setAttribute("data-pl-id", id);
    el.setAttribute("type", "date");
    document.body.appendChild(el);
    return el;
  };

  const dmy = mk("dob1");
  await __PL.executeAction({ action: "type", targetId: "dob1" }, "14/03/1999");
  assert.equal(dmy.value, "1999-03-14");

  const iso = mk("dob2");
  await __PL.executeAction({ action: "type", targetId: "dob2" }, "1999-03-14");
  assert.equal(iso.value, "1999-03-14");

  const words = mk("dob3");
  await __PL.executeAction({ action: "type", targetId: "dob3" }, "March 14, 1999");
  assert.equal(words.value, "1999-03-14");

  const garbage = mk("dob4");
  const res = await __PL.executeAction({ action: "type", targetId: "dob4" }, "ghjkj");
  assert.equal(res.ok, false);
  assert.match(res.note, /Rejected invalid value .* for input type="date"/);
  assert.equal(garbage.value, "");
});

test("Executor - rejects hallucinated VLM literalValue for a date field without touching the DOM", async () => {
  const { document, __PL } = setupContext();

  const dob = document.createElement("INPUT");
  dob.setAttribute("data-pl-id", "dob");
  dob.setAttribute("type", "date");
  document.body.appendChild(dob);

  let touched = false;
  dob.addEventListener("input", () => { touched = true; });
  dob.addEventListener("change", () => { touched = true; });

  // Server VLM hallucinates: {action:"type", targetId:"dob", literalValue:"ghjkkjhgf"}
  const res = await __PL.executeAction(
    { action: "type", targetId: "dob", literalValue: "ghjkkjhgf" },
    null
  );

  assert.equal(res.ok, false);
  assert.match(res.note, /DOM untouched/);
  assert.equal(dob.value, "");
  assert.equal(touched, false);
});

test("Executor - normalizeInputValue contract (string | \"\" | null)", () => {
  const { document, __PL } = setupContext();
  const el = (type) => { const e = document.createElement("INPUT"); e.setAttribute("type", type); return e; };

  assert.equal(__PL.normalizeInputValue(el("date"), null), null);
  assert.equal(__PL.normalizeInputValue(el("date"), "   "), "");
  assert.equal(__PL.normalizeInputValue(el("date"), "14-03-1999"), "1999-03-14");
  assert.equal(__PL.normalizeInputValue(el("date"), "nope"), null);
  assert.equal(__PL.normalizeInputValue(el("month"), "3/2024"), "2024-03");
  assert.equal(__PL.normalizeInputValue(el("time"), "2:15 pm"), "14:15");
  assert.equal(__PL.normalizeInputValue(el("datetime-local"), "1999-03-14 09:30"), "1999-03-14T09:30");
  assert.equal(__PL.normalizeInputValue(el("color"), "red"), "#ff0000");
  assert.equal(__PL.normalizeInputValue(el("text"), "  hello  "), "hello");
});

test("Executor - rejects non-numeric values for <input type=number>", async () => {
  const { document, __PL } = setupContext();

  const num = document.createElement("INPUT");
  num.setAttribute("data-pl-id", "age");
  num.setAttribute("type", "number");
  document.body.appendChild(num);

  const bad = await __PL.executeAction({ action: "type", targetId: "age" }, "twenty");
  assert.equal(bad.ok, false);
  assert.equal(num.value, "");

  await __PL.executeAction({ action: "type", targetId: "age" }, "age: 27 years");
  assert.equal(num.value, "27");
});

test("Executor - fills tokenized censored field when local profile value is supplied and blocks when missing", async () => {
  const { document, __PL } = setupContext();

  const sensitiveFields = ["aadhaar", "PAN", "credit-card", "cvv", "ssn", "password", "bank account information"];
  for (const cat of sensitiveFields) {
    const input = document.createElement("INPUT");
    input.setAttribute("data-pl-id", `field-${cat}`);
    input.setAttribute("data-pl-pii", cat);
    document.body.appendChild(input);

    // 1. Local resolution supplies real value -> Filled successfully on device!
    const resSuccess = await __PL.executeAction({ action: "type", targetId: `field-${cat}`, fillToken: `local:${cat}` }, "999-00-1234");
    assert.equal(resSuccess.ok, true);
    assert.equal(input.value, "999-00-1234");

    // Reset input
    input.value = "";

    // 2. Local resolution supplies null (no local data) -> Blocked!
    const resBlocked = await __PL.executeAction({ action: "type", targetId: `field-${cat}`, fillToken: `local:${cat}` }, null);
    assert.equal(resBlocked.ok, false);
    assert.match(resBlocked.note, /Blocked/);
    assert.equal(input.value, "");
  }
});
