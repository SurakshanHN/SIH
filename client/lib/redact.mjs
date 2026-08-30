// Pixel-space redaction on a canvas. Used in the offscreen document to sanitize
// the screenshot before it is sent to the server.
//
// Modes:
//   "pixelate" - mosaic (deterministic, no canvas-filter dependency) [default]
//   "blur"     - gaussian via canvas filter
//   "blackout" - solid fill (for maximum-secrecy categories: password, cvv)
//
// A region is { x, y, w, h, category, mode? } in *canvas pixels*.

const SECRECY_BLACKOUT = new Set(["password", "CVV/security code", "credit-card", "credit/debit card number", "cvv"]);

function clampRegion(r, W, H) {
  const x = Math.max(0, Math.min(W, Math.floor(r.x)));
  const y = Math.max(0, Math.min(H, Math.floor(r.y)));
  const w = Math.max(1, Math.min(W - x, Math.ceil(r.w)));
  const h = Math.max(1, Math.min(H - y, Math.ceil(r.h)));
  return { x, y, w, h };
}

function pixelateRegion(ctx, r, block = 12) {
  const { x, y, w, h } = r;
  const cols = Math.max(1, Math.round(w / block));
  const rows = Math.max(1, Math.round(h / block));
  // shrink then blow back up with smoothing off
  const tmp = ctx.canvas.constructor === OffscreenCanvas
    ? new OffscreenCanvas(cols, rows)
    : Object.assign(document.createElement("canvas"), { width: cols, height: rows });
  const tctx = tmp.getContext("2d");
  tctx.imageSmoothingEnabled = false;
  tctx.drawImage(ctx.canvas, x, y, w, h, 0, 0, cols, rows);
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tmp, 0, 0, cols, rows, x, y, w, h);
  ctx.restore();
}

function blurRegion(ctx, r, radius = 10) {
  const { x, y, w, h } = r;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  if ("filter" in ctx) ctx.filter = `blur(${radius}px)`;
  ctx.drawImage(ctx.canvas, x, y, w, h, x, y, w, h);
  ctx.filter = "none";
  ctx.restore();
  // filter blur can leave a faint ghost; overlay a light scrim
  ctx.save();
  ctx.fillStyle = "rgba(120,120,120,0.25)";
  ctx.fillRect(x, y, w, h);
  ctx.restore();
}

function blackoutRegion(ctx, r) {
  ctx.save();
  ctx.fillStyle = "#0a0a0a";
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.restore();
}

/**
 * Apply redaction in place.
 * @param {OffscreenCanvas|HTMLCanvasElement} canvas
 * @param {Array} regions
 * @param {{mode?: "pixelate"|"blur"|"blackout", pad?: number, block?: number, radius?: number}} opts
 * @returns {{count:number, regions:Array}}
 */
export function redactCanvas(canvas, regions, opts = {}) {
  const { mode = "pixelate", pad = 3, block = 12, radius = 10 } = opts;
  const ctx = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;
  const applied = [];
  for (const raw of regions || []) {
    const padded = { x: raw.x - pad, y: raw.y - pad, w: raw.w + pad * 2, h: raw.h + pad * 2 };
    const r = clampRegion(padded, W, H);
    if (r.w < 2 || r.h < 2) continue;
    const m = raw.mode || (SECRECY_BLACKOUT.has(raw.category) ? "blackout" : mode);
    if (m === "blackout") blackoutRegion(ctx, r);
    else if (m === "blur") blurRegion(ctx, r, radius);
    else pixelateRegion(ctx, r, block);
    applied.push({ ...r, category: raw.category, mode: m });
  }
  return { count: applied.length, regions: applied };
}

/** Fraction of PII pixels still recoverable = leak proxy (for the eval harness). */
export function leakScore(originalCanvas, redactedCanvas, regions) {
  const a = originalCanvas.getContext("2d");
  const b = redactedCanvas.getContext("2d");
  let changed = 0;
  let total = 0;
  for (const r of regions) {
    const rr = clampRegion(r, originalCanvas.width, originalCanvas.height);
    const da = a.getImageData(rr.x, rr.y, rr.w, rr.h).data;
    const db = b.getImageData(rr.x, rr.y, rr.w, rr.h).data;
    for (let i = 0; i < da.length; i += 4) {
      total++;
      if (Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]) > 24) changed++;
    }
  }
  return total ? 1 - changed / total : 0;
}

export default { redactCanvas, leakScore };
