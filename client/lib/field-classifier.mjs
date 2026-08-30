// DOM-free port of the field classifier in content.js.
// Source of truth for the *value* used by eval/ and tests/. content.js keeps an
// inline copy (content scripts can't import ESM); keep the two in sync.
// Operates on a plain "signals" object so it needs no browser.

export const MATCHERS = [
  { category: "password", type: /password/i, autocomplete: /^(new-password|current-password)$/i, nameId: /\b(password|passcode|passwd)\b/i, labelPlaceholder: /\b(password|passcode|passwd)\b/i },
  { category: "email", type: /email/i, autocomplete: /^email$/i, nameId: /\b(email|e-mail|mail_addr|mailaddr)\b/i, labelPlaceholder: /\b(email|e-mail|mail_addr|mailaddr)\b/i },
  { category: "username", autocomplete: /^(username|nickname)$/i, nameId: /\b(username|user_name|usrname|userid|user_id|login_id|loginid)\b/i, labelPlaceholder: /\b(username|user_name|usrname|userid|user_id|login_id|loginid)\b/i },
  { category: "phone number", type: /tel/i, autocomplete: /\b(tel|phone|mobile)\b/i, nameId: /\b(phone|telephone|mobile|cellphone|contact_no|contact_number|phone_no|phoneno|tel_no)\b/i, labelPlaceholder: /\b(phone|telephone|mobile|cellphone|contact_no|contact_number|phone_no|phoneno|tel_no)\b/i },
  { category: "credit/debit card number", autocomplete: /^cc-number$/i, nameId: /\b(cardnum|cardnumber|card_number|cc_number|cc-number|ccnum|creditcard|debitcard|credit_card|debit_card)\b/i, labelPlaceholder: /\b(card ?number|cardnum|creditcard|debitcard)\b/i },
  { category: "CVV/security code", autocomplete: /^cc-csc$/i, nameId: /\b(cvv|cvc|security_code|security-code|card_security_code|csc)\b/i, labelPlaceholder: /\b(cvv|cvc|security code|card security code|csc)\b/i },
  { category: "card expiry", autocomplete: /^(cc-exp|cc-exp-month|cc-exp-year)$/i, nameId: /\b(expdate|expiration|exp_date|expiry|cc-exp|cc_exp)\b/i, labelPlaceholder: /\b(expiry|expiration|exp\.? date)\b/i },
  { category: "first name", autocomplete: /^given-name$/i, nameId: /\b(firstname|first_name|fname|given_name|givenname)\b/i, labelPlaceholder: /\b(first name|given name)\b/i },
  { category: "last name", autocomplete: /^family-name$/i, nameId: /\b(lastname|last_name|last-name|lname|family_name|surname)\b/i, labelPlaceholder: /\b(last name|family name|surname)\b/i },
  { category: "full name", autocomplete: /^name$/i, nameId: /\b(fullname|full_name)\b/i, labelPlaceholder: /\b(full name)\b/i },
  { category: "date of birth", autocomplete: /^(bday|bday-day|bday-month|bday-year)$/i, nameId: /\b(dob|birthdate|date_of_birth|birth_date|bday)\b/i, labelPlaceholder: /\b(date of birth|birth date|dob)\b/i },
  { category: "address", autocomplete: /\b(street-address|address-line|address-level)\b/i, nameId: /\b(address|street|addr|residence|addr1|addr2|address1|address2|street_address)\b/i, labelPlaceholder: /\b(address|street)\b/i },
  { category: "postal/ZIP code", autocomplete: /^postal-code$/i, nameId: /\b(zipcode|zip_code|zip|postalcode|postal_code|pincode|pin_code|postcode)\b/i, labelPlaceholder: /\b(zip|postal code|pin code|pincode|postcode)\b/i },
  { category: "Aadhaar", nameId: /\b(aadhar|aadhaar|uidai|uid)\b/i, labelPlaceholder: /\b(aadhaar|aadhar|uidai)\b/i },
  { category: "PAN", nameId: /\b(pan|pannumber|pan_number|pancard|pan_card)\b/i, labelPlaceholder: /\bpan\b/i },
  { category: "SSN", autocomplete: /^ssn$/i, nameId: /\b(ssn|socialsecurity|social_security)\b/i, labelPlaceholder: /\b(ssn|social security)\b/i },
  { category: "passport number", nameId: /\b(passport|passportnum|passport_number|passportno)\b/i, labelPlaceholder: /\bpassport\b/i },
  { category: "government ID", nameId: /\b(govt_id|govtid|government_id|national_id|nationalid|state_id|stateid|drivers_license|driver_license|dl_number|dl_num|licence_number|license_no|epic_no|voter_id|voterid)\b/i, labelPlaceholder: /\b(government id|national id|driver'?s licen[cs]e|voter id|epic)\b/i },
  { category: "bank account information", nameId: /\b(bankaccount|bank_account|account_number|account_no|routing_number|routing_no|routing_num|aba_number|iban|swift|bic|ifsc)\b/i, labelPlaceholder: /\b(bank account|account number|routing number|iban|swift|ifsc)\b/i },
];

const NAME_EXCLUDE = /\b(domain|search|pet|product|file|host|category|display|class|group|event|stage|repo|project|company|brand|user)\b/i;

/**
 * @param {{tagName:string,type?:string,name?:string,id?:string,autocomplete?:string,placeholder?:string,ariaLabel?:string,labelText?:string,nearbyText?:string}} s
 * @returns {{category:string, confidence:number}|null}
 */
export function classifySignals(s) {
  const g = (k) => (s[k] || "").toLowerCase();
  const tag = (s.tagName || "").toLowerCase();
  const type = g("type");
  if (tag === "input" && ["button", "submit", "reset", "image", "file", "checkbox", "radio", "range", "color", "hidden"].includes(type)) return null;

  let best = null;
  let max = 0;
  for (const m of MATCHERS) {
    let c = 0;
    if (tag === "input" && m.type && m.type.test(type)) c = Math.max(c, 1.0);
    if (g("autocomplete") && m.autocomplete && m.autocomplete.test(g("autocomplete"))) c = Math.max(c, 0.95);
    if (m.nameId && (m.nameId.test(g("name")) || m.nameId.test(g("id")))) c = Math.max(c, 0.85);
    if (m.labelPlaceholder && (m.labelPlaceholder.test(g("placeholder")) || m.labelPlaceholder.test(g("ariaLabel")) || m.labelPlaceholder.test(g("labelText")))) c = Math.max(c, 0.75);
    if (m.labelPlaceholder && m.labelPlaceholder.test(g("nearbyText"))) c = Math.max(c, 0.45);
    if (c > max) { max = c; best = { category: m.category, confidence: c }; }
  }
  if (max < 0.7) {
    const exact = /^(name|full_name|fullname)$/i;
    if ([g("name"), g("id"), g("placeholder"), g("ariaLabel"), g("labelText")].some((v) => exact.test(v)) &&
        !NAME_EXCLUDE.test([g("name"), g("id"), g("placeholder"), g("labelText")].join(" "))) {
      best = { category: "full name", confidence: 0.7 };
      max = 0.7;
    }
  }
  return max >= 0.5 ? best : null;
}

export default { MATCHERS, classifySignals };
