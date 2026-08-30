// Executes one validated action from the server. Token -> real-value resolution
// happens in the caller (agent-bridge) so real PII only ever appears here, in
// the page context that is about to receive it anyway.

(function () {
  const byId = (id) => document.querySelector(`[data-pl-id="${CSS.escape(id)}"]`);

  function setNativeValue(el, value) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
      : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype
      : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(el, value);
    else el.value = value;
  }

  function fireInput(el) {
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
  }

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
    el.scrollIntoView({ behavior: "instant", block: "center" });

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

    const value = a.valueToken != null || a.literalValue != null ? String(resolvedValue ?? a.literalValue ?? "") : "";

    if (a.action === "select") {
      const opt = [...(el.options || [])].find(
        (o) => o.value === value || o.textContent.trim().toLowerCase() === value.toLowerCase()
      );
      if (!opt) return { ok: false, note: `no option matching "${value}"` };
      setNativeValue(el, opt.value);
      fireInput(el);
      return { ok: true, note: `selected ${opt.textContent.trim()}` };
    }

    if (a.action === "type") {
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

  // read-back: does the field now hold the value we intended? (loop early-stop)
  function verifyField(targetId, expected) {
    const el = byId(targetId);
    if (!el) return false;
    const got = (el.value ?? el.textContent ?? "").trim();
    return got.replace(/\s+/g, "") === String(expected).trim().replace(/\s+/g, "");
  }

  window.__PL = window.__PL || {};
  window.__PL.executeAction = executeAction;
  window.__PL.verifyField = verifyField;
})();
