# Privacy Lens — On-Device Vision Agent

**SIH26171 · On-device Visual Perception for Light-weight Browser Agents**

A browser extension + server that lets a cloud/served VLM drive form-filling on any
page **without ever seeing the user's personal data**. The client reads the screen
with on-device vision (OCR + face detection) and a DOM classifier, redacts every
PII region locally, tokenises the rest, and sends only a blurred screenshot + a
token-ised page structure to the server. The server returns UI actions that
reference *tokens*; the client resolves them to real values locally, at the last
moment, and types them in.

```
┌───────────────────────── BROWSER — real PII never leaves here ─────────────────────────┐
│ content + agent-bridge     skeleton (values → empty/filled) · DOM PII boxes · vault    │
│        │                   (profile values → [AADHAAR_1] …, stored in chrome.storage)  │
│        │  captureVisibleTab → raw screenshot                                            │
│        ▼                                                                               │
│ offscreen document         Tesseract OCR + BlazeFace  →  PII regions                   │
│  (WebGPU/WASM)             merge(DOM ∪ vision)  →  redact screenshot (blur/pixelate)    │
│        │                                                                               │
│        ▼                                                                               │
│ background (service worker)  build sanitized payload · show egress preview in popup    │
│        │                                                                               │
└────────┼──────────────────────────────────────────────────────────────────────────────┘
         │  POST /agent/step   { redacted screenshot, token-ised skeleton, token→category }
         ▼
┌──────────────── SERVER ────────────────┐
│ FastAPI + VLM (Qwen2.5-VL / Llama-3.2- │   returns  [{action:"type", targetId:"el-4",
│ Vision, or the offline `mock` agent)   │            valueToken:"[AADHAAR_1]"}, …]
└────────────────────────────────────────┘
         │
         ▼  client validates → resolves [AADHAAR_1] → real value locally → executor types it
```

## Layout

| Path | What |
|---|---|
| `client/` | MV3 extension (Chrome + Firefox). Plain JS, no bundler. |
| `client/lib/*.mjs` | Shared logic: `pii-rules` (regex + Verhoeff/Luhn), `tokenizer` (vault), `redact` (canvas), `merge`, `field-classifier`, `agent-client`. |
| `client/offscreen.*` | On-device OCR + face detection + redaction. |
| `server/` | FastAPI agent. `VLM_MODE=mock` (offline, default) or `openai` (any OpenAI-compatible VLM endpoint). |
| `fixtures/` | 3 demo forms: job application, checkout, KYC. |
| `eval/` | Metric harness (`run_eval.mjs` headless + `eval.html` in-browser). |
| `tests/` | `node --test` unit tests for the shared logic. |

## Setup

```bash
npm run fetch:vendor     # download Tesseract.js + MediaPipe into client/vendor/  (~40 MB, once)
npm run server:install   # pip install FastAPI etc. (use a venv)
npm test                 # 19 unit tests
npm run eval             # headless metric report
```

### Run the demo

```bash
npm run server           # http://localhost:8000  (VLM_MODE=mock by default)
npm run fixtures         # http://localhost:4173  (the 3 demo forms)
```

1. `chrome://extensions` → Developer mode → **Load unpacked** → select `client/`.
2. Open the extension popup → **Profile** tab → fill in some values → **Save profile**
   (they go to `chrome.storage.local` only).
3. Open a fixture (e.g. `http://localhost:4173/kyc.html`).
4. Popup → **Assist** tab → pick a preset or type a goal → **Start agent**.
5. Watch the **Activity** tab: per-step you see the *exact* redacted screenshot +
   JSON leaving the machine, the server's plan, and each action being executed on
   the page (redacted regions flash red, targeted fields flash green).

### Real VLM instead of the mock agent

```bash
cp server/.env.example server/.env      # set VLM_MODE=openai, VLM_BASE_URL, VLM_API_KEY, VLM_MODEL
# e.g. OpenRouter qwen/qwen-2.5-vl-7b-instruct, or a local vLLM / Ollama llama3.2-vision
```
The redacted screenshot is sent as an `image_url`, so the model genuinely uses
visual context. Falls back to `mock` automatically if the endpoint errors.

## Privacy model

- **The vault** (real profile values) lives only in the page's content-script world
  and `chrome.storage.local`. The background worker, the offscreen document, and
  the network only ever handle `[CATEGORY_N]` tokens + redacted pixels.
- **The screenshot** is redacted in the offscreen document *before* it reaches the
  background worker — OCR'd PII spans, detected faces, and every DOM PII field
  bbox (blur / pixelate; blackout for passwords & card numbers).
- **The skeleton** reports field values only as `empty` / `filled` / `readonly`.
- The server is told the scheme (`GET /privacy`) and instructed never to request a
  real value; every returned action is validated against the known element ids and
  tokens before the executor runs it.
- **Egress preview**: the popup shows the byte-for-byte payload each step; the
  headless eval asserts no profile value ever appears in it.

## Evaluation (maps to the 5 SIH metrics)

| # | Metric | Where |
|---|---|---|
| 1 | Visual-context accuracy (25%) | `eval.html` — structure recall; extension fuses OCR + screenshot on top |
| 2 | PII detection precision/recall (20%) | `npm run eval` — field classifier + value regex, with a labelled corpus |
| 3 | Redaction precision (20%) | `eval.html` — pixel IoU / leak score (`redact.mjs` `leakScore`) |
| 4 | Client resource use (20%) | extension Activity panel — per-step OCR/face/redact ms, heap, WebGPU adapter |
| 5 | End-to-end latency (15%) | extension Activity panel — capture → vision → network → execute |

Run `node scripts/serve.mjs . 4173` then open `http://localhost:4173/eval/eval.html`.

## Status / limitations

- On-device vision is deliberately **light** (Tesseract OCR + BlazeFace) — the DOM
  classifier is the primary detector; vision is the safety net for canvas / images
  / cross-origin frames. A transformer NER (Transformers.js is already vendored)
  and a screenshot-level PII detector are the next upgrades.
- The `mock` agent is deterministic (reads the skeleton, fills PII fields from
  their tokens). It makes the full pipeline run offline and is the fallback when a
  real VLM misbehaves.
- Fixtures are written to exercise the classifier; real-world pages score lower.
- Firefox: MV3 + offscreen differ slightly; a background-page shim is noted in
  `client/offscreen.js` comments.
