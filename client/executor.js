// Executes one validated action from the server.
// Whatever is redacted/censored is strictly prohibited from being filled.

(function () {
  const byId = (id) => document.querySelector(`[data-pl-id="${CSS.escape(id)}"]`);

  const SENSITIVE_PATTERNS = window.__PL.SENSITIVE_PATTERNS;
  const CENSORED_CATEGORIES = window.__PL.CENSORED_CATEGORIES;

  // ═══════════════════════════════════════════════════════════════════════
  // Check if an element is a redacted / censored / sensitive field
  // ═══════════════════════════════════════════════════════════════════════

  function isElementCensored(el) {
    if (!el) return false;

    // 1. Check if marked by dom-redactor or skeleton
    if (el.hasAttribute("data-pl-redacted") || el.closest("[data-pl-redacted]")) {
      return true;
    }

    // 2. Check data attributes
    const gt = el.getAttribute("data-gt") || el.getAttribute("data-pl-pii");
    if (gt && (CENSORED_CATEGORIES.has(gt) || SENSITIVE_PATTERNS.test(gt))) {
      return true;
    }

    // 3. Check classifyElement
    try {
      if (typeof classifyElement === "function") {
        const c = classifyElement(el);
        if (c?.category && (CENSORED_CATEGORIES.has(c.category) || SENSITIVE_PATTERNS.test(c.category))) {
          return true;
        }
      }
    } catch {}

    // 4. Check element attributes (name, id, placeholder, label, type)
    const text = [
      el.getAttribute("name") || "",
      el.getAttribute("id") || "",
      el.getAttribute("placeholder") || "",
      el.getAttribute("aria-label") || "",
      el.getAttribute("type") || "",
      el.closest("label")?.textContent || "",
    ].join(" ");

    if (SENSITIVE_PATTERNS.test(text)) {
      return true;
    }

    if (el.type === "password") return true;

    return false;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // DOM helpers
  // ═══════════════════════════════════════════════════════════════════════

  function setNativeValue(el, value) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
      : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype
      : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(el, value);
    else el.value = value;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Typed-input normalizer
  //
  // <input type="date|month|time|...|number|color"> only accepts one wire
  // format. Handing the browser "14/03/1999" or "ghjkj" makes it silently
  // drop the value and log a console error. normalizeInputValue() coerces the
  // model's free-text value into the required format and returns:
  //   - a normalized string when it can be represented for this input type
  //   - ""   for an empty/whitespace value
  //   - null when the value is invalid for the type (caller must not fill)
  // ═══════════════════════════════════════════════════════════════════════

  function pad2(n) { return String(n).padStart(2, "0"); }

  function parseDateParts(raw) {
    const v = String(raw).trim();
    if (!v) return null;

    // Already ISO (yyyy-mm-dd, optionally with time) → take the date portion.
    let m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return { y: +m[1], mo: +m[2], d: +m[3] };

    // Numeric d/m/y or y/m/d with / . or - separators.
    m = v.match(/^(\d{1,4})[/.\-](\d{1,2})[/.\-](\d{1,4})$/);
    if (m) {
      let [, a, b, c] = m;
      a = +a; b = +b; c = +c;
      if (String(m[1]).length === 4) return { y: a, mo: b, d: c };      // y/m/d
      if (c < 100) c += c < 70 ? 2000 : 1900;                            // 2-digit year
      // a/b/c is day/month or month/day; disambiguate by range, else day-first.
      if (a > 12 && b <= 12) return { y: c, mo: b, d: a };
      if (b > 12 && a <= 12) return { y: c, mo: a, d: b };
      return { y: c, mo: b, d: a };                                      // default DD/MM/YYYY
    }

    // Fall back to the engine's parser ("March 14, 1999", "14 Mar 1999", …).
    const t = Date.parse(v);
    if (!Number.isNaN(t)) {
      const dt = new Date(t);
      return { y: dt.getFullYear(), mo: dt.getMonth() + 1, d: dt.getDate() };
    }
    return null;
  }

  function toISODate(raw) {
    const p = parseDateParts(raw);
    if (!p || p.mo < 1 || p.mo > 12 || p.d < 1 || p.d > 31 || p.y < 1) return null;
    return `${String(p.y).padStart(4, "0")}-${pad2(p.mo)}-${pad2(p.d)}`;
  }

  function parseTimeParts(raw) {
    const v = String(raw).trim();
    // Find an HH:MM[:SS] [am/pm] token anywhere (so a datetime string works too).
    const m = v.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]\.?m\.?)?/i);
    if (!m) return null;
    let h = +m[1];
    const min = +m[2];
    const ampm = (m[4] || "").toLowerCase();
    if (ampm.startsWith("p") && h < 12) h += 12;
    if (ampm.startsWith("a") && h === 12) h = 0;
    if (h > 23 || min > 59) return null;
    return { h, min, s: m[3] != null ? +m[3] : null };
  }

  function inputType(el) {
    return (
      (el.tagName === "INPUT" && (el.getAttribute("type") || el.type)) || "text"
    ).toLowerCase();
  }

  /**
   * @param {Element} el
   * @param {*} rawValue
   * @returns {string|null}  normalized string, "" for empty, or null when invalid for the type
   */
  function normalizeInputValue(el, rawValue) {
    if (rawValue == null) return null;
    const value = String(rawValue).trim();
    if (!value) return "";

    switch (inputType(el)) {
      case "date":
        return toISODate(value);
      case "month": {
        if (/^\d{4}-\d{2}$/.test(value)) return value;
        let m = value.match(/^(\d{1,2})[/.\-](\d{4})$/);           // MM/YYYY
        if (m && +m[1] >= 1 && +m[1] <= 12) return `${m[2]}-${pad2(+m[1])}`;
        m = value.match(/^(\d{4})[/.\-](\d{1,2})$/);               // YYYY/MM
        if (m && +m[2] >= 1 && +m[2] <= 12) return `${m[1]}-${pad2(+m[2])}`;
        const iso = toISODate(value) || toISODate(value + "-01");  // "March 2024", etc.
        return iso ? iso.slice(0, 7) : null;
      }
      case "datetime-local": {
        const iso = toISODate(value);
        if (!iso) return null;
        const tm = parseTimeParts(value);
        return `${iso}T${tm ? pad2(tm.h) + ":" + pad2(tm.min) : "00:00"}`;
      }
      case "time": {
        const tm = parseTimeParts(value);
        return tm ? `${pad2(tm.h)}:${pad2(tm.min)}${tm.s != null ? ":" + pad2(tm.s) : ""}` : null;
      }
      case "number":
      case "range": {
        // Pull the first numeric token out of the string ("age: 27" → "27").
        const m = value.replace(/,/g, "").match(/-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?/);
        return m && Number.isFinite(Number(m[0])) ? m[0] : null;
      }
      case "color": {
        let c = value.toLowerCase();
        const named = { black: "#000000", white: "#ffffff", red: "#ff0000", green: "#008000", blue: "#0000ff" };
        if (named[c]) c = named[c];
        if (/^#[0-9a-f]{3}$/.test(c)) c = "#" + c.slice(1).split("").map((x) => x + x).join("");
        return /^#[0-9a-f]{6}$/.test(c) ? c : null;
      }
      default:
        return value;
    }
  }

  function fireInput(el) {
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Select handler
  // ═══════════════════════════════════════════════════════════════════════

  function handleSelect(el, value) {
    const options = [...(el.options || [])];
    if (options.length === 0) return { ok: false, note: "select has no options" };

    if (value != null && value !== "") {
      const valStr = String(value);
      const exact = options.find(
        (o) => o.value === valStr || o.textContent.trim().toLowerCase() === valStr.toLowerCase()
      );
      if (exact) {
        setNativeValue(el, exact.value);
        fireInput(el);
        return { ok: true, note: `selected "${exact.textContent.trim()}"` };
      }

      const fuzzy = options.find((o) => {
        const text = o.textContent.trim().toLowerCase();
        const val = o.value.toLowerCase();
        const needle = valStr.toLowerCase();
        return text.includes(needle) || val.includes(needle)
          || needle.includes(text) || needle.includes(val);
      });
      if (fuzzy) {
        setNativeValue(el, fuzzy.value);
        fireInput(el);
        return { ok: true, note: `fuzzy-selected "${fuzzy.textContent.trim()}"` };
      }
    }

    const fallbackIdx = options.length > 1 ? 1 : 0;
    const fallback = options[fallbackIdx];
    setNativeValue(el, fallback.value);
    fireInput(el);
    return { ok: true, note: `default-selected index ${fallbackIdx}: "${fallback.textContent.trim()}"` };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Main action executor
  // ═══════════════════════════════════════════════════════════════════════

  async function executeAction(action, resolvedValue) {
    const a = action || {};
    if (a.action === "wait") {
      await new Promise((r) => setTimeout(r, Math.min(3000, a.ms || 500)));
      return { ok: true, note: "waited" };
    }
    if (a.action === "scroll") {
      const el = a.targetId && byId(a.targetId);
      if (el) el.scrollIntoView({ behavior: "instant", block: "center" });
      else window.scrollBy({ top: a.dy || window.innerHeight * 0.8, behavior: "instant" });
      return { ok: true, note: "scrolled" };
    }
    if (a.action === "done") return { ok: true, note: "done", done: true };

    const el = byId(a.targetId);
    if (!el) return { ok: false, note: `no element ${a.targetId}` };
    el.scrollIntoView?.({ behavior: "instant", block: "center" });

    // Guard: If element is redacted/censored and no resolved local profile value was provided, block filling
    if ((isElementCensored(el) || (a.piiCategory && SENSITIVE_PATTERNS.test(a.piiCategory))) && resolvedValue == null) {
      return { ok: false, note: `Blocked: element ${a.targetId} is redacted/censored and no local profile value is available` };
    }

    if (a.action === "click") {
      el.focus?.();
      el.click();
      return { ok: true, note: `clicked ${a.targetId}` };
    }

    if (a.action === "submit") {
      const form = el.form || el.closest("form");
      if (!form) return { ok: false, note: "no form to submit" };
      if (typeof form.requestSubmit === "function") form.requestSubmit(el.tagName === "BUTTON" ? el : undefined);
      else form.submit();
      return { ok: true, note: "submitted", done: true };
    }

    // ── Resolve the value to inject ───────────────────────────────────
    let value = resolvedValue != null ? String(resolvedValue) : (a.literalValue != null ? String(a.literalValue) : "");

    // ── SELECT elements ──────────────────────────────────────────────
    if (a.action === "select" || (a.action === "type" && el.tagName === "SELECT")) {
      return handleSelect(el, value || a.literalValue || resolvedValue);
    }

    if (el.tagName === "SELECT") {
      return handleSelect(el, value);
    }

    // ── TYPE action ──────────────────────────────────────────────────
    if (a.action === "type") {
      if (!value) {
        return { ok: false, note: `no value to type into ${a.targetId}` };
      }

      // ── Validate BEFORE touching the DOM ──────────────────────────
      // The server VLM can hallucinate junk ("ghjkkjhgf") for a typed
      // input. A typed field (date/month/time/number/color/…) that can't
      // represent the value is rejected here — no focus, no value write,
      // no events — so bad model output never reaches the page.
      if (!el.isContentEditable) {
        const normalizedValue = normalizeInputValue(el, value);
        if (normalizedValue === null) {
          return { ok: false, note: `Rejected invalid value "${value}" for input type="${inputType(el)}" — DOM untouched` };
        }
        value = normalizedValue;
      }

      el.focus?.();
      if (el.isContentEditable) {
        el.textContent = value;
        el.dispatchEvent(new InputEvent("input", { bubbles: true }));
      } else {
        setNativeValue(el, "");
        setNativeValue(el, value);
        fireInput(el);
      }
      el.blur?.();
      return { ok: true, note: `typed into ${a.targetId} (${value.length} chars)` };
    }

    return { ok: false, note: `unhandled action ${a.action}` };
  }

  function verifyField(targetId, expected) {
    const el = byId(targetId);
    if (!el) return false;
    const got = (el.value ?? el.textContent ?? "").trim();
    // Compare against the normalized form — a date field holds "1999-03-14"
    // even though the caller passed "14/03/1999".
    let want = String(expected);
    if (!el.isContentEditable) {
      const normalized = normalizeInputValue(el, want);
      if (normalized != null) want = normalized;
    }
    return got.replace(/\s+/g, "") === want.trim().replace(/\s+/g, "");
  }

  window.__PL = window.__PL || {};
  window.__PL.executeAction = executeAction;
  window.__PL.verifyField = verifyField;
  window.__PL.isElementCensored = isElementCensored;
  window.__PL.normalizeInputValue = normalizeInputValue;
})();
