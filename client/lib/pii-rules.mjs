// Value-format PII detection: regex + checksums.
// Runs on (a) OCR'd screen text in the offscreen document and (b) any raw text
// the client is about to send. Detects the *value*, not just the field name.
//
// India-first catalogue (Aadhaar/PAN/UPI/IFSC/EPIC/vehicle) plus common global
// identifiers. Checksums (Verhoeff, Luhn) gate the noisy numeric patterns so the
// precision score stays high.

// ---- checksums -------------------------------------------------------------

const VERHOEFF_D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const VERHOEFF_P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

export function verhoeffValid(digits) {
  const s = String(digits).replace(/\D/g, "");
  if (s.length !== 12) return false;
  let c = 0;
  const rev = s.split("").reverse();
  for (let i = 0; i < rev.length; i++) {
    c = VERHOEFF_D[c][VERHOEFF_P[i % 8][Number(rev[i])]];
  }
  return c === 0;
}

export function luhnValid(digits) {
  const s = String(digits).replace(/\D/g, "");
  if (s.length < 12 || s.length > 19) return false;
  let sum = 0;
  let dbl = false;
  for (let i = s.length - 1; i >= 0; i--) {
    let d = Number(s[i]);
    if (dbl) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

// ---- rules ----------------------------------------------------------------

// Each rule: { category, re (global), validate?(match) => bool, confidence }
export const RULES = [
  {
    category: "email",
    re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    confidence: 0.97,
  },
  {
    category: "aadhaar",
    re: /\b\d{4}\s?\d{4}\s?\d{4}\b/g,
    validate: (m) => verhoeffValid(m),
    confidence: 0.98,
  },
  {
    category: "pan",
    re: /\b[A-Z]{5}[0-9]{4}[A-Z]\b/g,
    confidence: 0.97,
  },
  {
    category: "gstin",
    re: /\b\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9]Z[A-Z0-9]\b/g,
    confidence: 0.97,
  },
  {
    category: "ifsc",
    re: /\b[A-Z]{4}0[A-Z0-9]{6}\b/g,
    confidence: 0.9,
  },
  {
    category: "upi-vpa",
    re: /\b[A-Za-z0-9.\-_]{2,}@(?:oksbi|okhdfcbank|okicici|okaxis|paytm|ybl|apl|ibl|axl|upi)\b/gi,
    confidence: 0.9,
  },
  {
    category: "voter-id",
    re: /\b[A-Z]{3}[0-9]{7}\b/g,
    confidence: 0.75,
  },
  {
    category: "vehicle-reg",
    re: /\b[A-Z]{2}[ -]?\d{1,2}[ -]?[A-Z]{1,3}[ -]?\d{4}\b/g,
    confidence: 0.75,
  },
  {
    category: "passport-in",
    re: /\b[A-PR-WY][1-9]\d\s?\d{4}[1-9]\b/g,
    confidence: 0.8,
  },
  {
    category: "credit-card",
    re: /\b(?:\d[ -]?){12,19}\b/g,
    validate: (m) => luhnValid(m),
    confidence: 0.95,
  },
  {
    category: "phone-in",
    re: /(?:\+?91[ -]?)?[6-9]\d{9}\b/g,
    confidence: 0.8,
  },
  {
    category: "ssn",
    re: /\b\d{3}-\d{2}-\d{4}\b/g,
    confidence: 0.9,
  },
  {
    category: "ipv4",
    re: /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g,
    confidence: 0.8,
  },
  {
    category: "dob",
    re: /\b(?:0?[1-9]|[12]\d|3[01])[/\-.](?:0?[1-9]|1[0-2])[/\-.](?:19|20)\d{2}\b/g,
    confidence: 0.6,
  },
];

/**
 * @param {string} text
 * @returns {Array<{category:string, value:string, start:number, end:number, confidence:number}>}
 */
export function detectPII(text) {
  if (!text || typeof text !== "string") return [];
  const hits = [];
  for (const rule of RULES) {
    rule.re.lastIndex = 0;
    let m;
    while ((m = rule.re.exec(text)) !== null) {
      const value = m[0];
      if (rule.validate && !rule.validate(value)) continue;
      hits.push({
        category: rule.category,
        value,
        start: m.index,
        end: m.index + value.length,
        confidence: rule.confidence,
      });
      if (m.index === rule.re.lastIndex) rule.re.lastIndex++;
    }
  }
  // Resolve overlaps: keep the higher-confidence / longer hit.
  hits.sort((a, b) => a.start - b.start || b.confidence - a.confidence || b.end - a.end);
  const kept = [];
  for (const h of hits) {
    const clash = kept.find((k) => h.start < k.end && k.start < h.end);
    if (!clash) kept.push(h);
  }
  return kept;
}

export default { detectPII, verhoeffValid, luhnValid, RULES };
