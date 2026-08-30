// Content-script side of the agent loop. Owns the ONE place real PII lives at
// runtime: the in-page vault built from the user's saved profile. Everything it
// hands to the background service worker is already tokenized.

(function () {
  if (window.__plAgentBridgeLoaded) return; // guard against double injection
  window.__plAgentBridgeLoaded = true;

  const PREFIX = {
    "first name": "FIRSTNAME", "last name": "LASTNAME", "full name": "NAME", email: "EMAIL",
    "phone number": "PHONE", address: "ADDRESS", "postal/ZIP code": "PIN", "date of birth": "DOB",
    Aadhaar: "AADHAAR", aadhaar: "AADHAAR", PAN: "PAN", pan: "PAN", "passport number": "PASSPORT",
    SSN: "SSN", ssn: "SSN", "credit/debit card number": "CARD", "CVV/security code": "CVV",
    "card expiry": "CARDEXP", "bank account information": "BANKACCT", ifsc: "IFSC", "upi-vpa": "UPI",
    username: "USERNAME", password: "PASSWORD", "government ID": "GOVTID",
  };
  const prefixFor = (c) => PREFIX[c] || String(c || "PII").toUpperCase().replace(/[^A-Z0-9]+/g, "");

  const vault = new Map(); // token -> value
  const counters = new Map();

  function mint(category) {
    const p = prefixFor(category);
    const n = (counters.get(p) || 0) + 1;
    counters.set(p, n);
    return `[${p}_${n}]`;
  }

  async function prepare() {
    vault.clear();
    counters.clear();
    const { profile = {} } = await chrome.storage.local.get("profile");
    const profileTokens = {}; // category -> token
    const tokenContext = {}; // token -> category
    for (const [category, value] of Object.entries(profile)) {
      if (value == null || String(value).trim() === "") continue;
      const token = mint(category);
      vault.set(token, String(value));
      profileTokens[category] = token;
      tokenContext[token] = category;
    }
    const skeleton = window.__PL.buildSkeleton();
    const domPiiBoxes = window.__PL.domPiiBoxes();
    // annotate each PII skeleton node with the profile token that would fill it
    for (const node of skeleton.nodes) {
      if (node.piiCategory && profileTokens[node.piiCategory]) {
        node.fillToken = profileTokens[node.piiCategory];
      }
    }
    return { skeleton, domPiiBoxes, tokenContext, profileTokens, profileKeys: Object.keys(profile) };
  }

  function resolve(token) {
    return token == null ? null : vault.get(token) ?? null;
  }

  async function execute(action) {
    const value = action.valueToken != null ? resolve(action.valueToken) : null;
    const result = await window.__PL.executeAction(action, value);
    // local read-back check (never leaves the page)
    if (result.ok && action.action === "type" && (value ?? action.literalValue) != null) {
      result.verified = window.__PL.verifyField(action.targetId, value ?? action.literalValue);
    }
    return result;
  }

  // simple on-page overlay so the demo shows what was redacted / targeted
  function highlight(regions, kind = "redact") {
    let layer = document.getElementById("__pl_overlay");
    if (!layer) {
      layer = document.createElement("div");
      layer.id = "__pl_overlay";
      layer.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483647";
      document.documentElement.appendChild(layer);
    }
    layer.replaceChildren();
    const dpr = window.devicePixelRatio || 1;
    for (const r of regions || []) {
      const d = document.createElement("div");
      const x = (r.x ?? r.bbox?.x ?? 0) / (r.deviceCoords ? dpr : 1);
      const y = (r.y ?? r.bbox?.y ?? 0) / (r.deviceCoords ? dpr : 1);
      const w = (r.w ?? r.bbox?.w ?? 0) / (r.deviceCoords ? dpr : 1);
      const h = (r.h ?? r.bbox?.h ?? 0) / (r.deviceCoords ? dpr : 1);
      d.style.cssText = `position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${h}px;` +
        (kind === "redact"
          ? "background:repeating-linear-gradient(45deg,rgba(239,111,97,.35)0 6px,rgba(239,111,97,.15)6px 12px);outline:1.5px solid #ef6f61"
          : "outline:2px solid #48b873;background:rgba(72,184,115,.12)");
      layer.appendChild(d);
    }
    setTimeout(() => layer && layer.replaceChildren(), 6000);
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action === "PL_PREPARE") {
      prepare().then((r) => sendResponse({ ok: true, ...r })).catch((e) => sendResponse({ ok: false, error: e.message }));
      return true;
    }
    if (msg.action === "PL_EXECUTE") {
      execute(msg.step).then((result) => sendResponse({ ok: true, result })).catch((e) => sendResponse({ ok: false, error: e.message }));
      return true;
    }
    if (msg.action === "PL_HIGHLIGHT") {
      highlight(msg.regions, msg.kind);
      sendResponse({ ok: true });
      return true;
    }
    if (msg.action === "PL_RESCAN") {
      sendResponse({ ok: true, skeleton: window.__PL.buildSkeleton(), domPiiBoxes: window.__PL.domPiiBoxes() });
      return true;
    }
  });
})();
