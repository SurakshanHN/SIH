function getSensitiveDOMBoxes() {
  const selectors = [
    'input[type="password"]',
    'input[type="email"]',
    'input[type="tel"]',
    'input[autocomplete="cc-number"]',
    'input[autocomplete="name"]',
    'input[autocomplete="street-address"]',
    'input[name*="ssn" i]',
    'input[name*="pan" i]',
    'input[name*="aadhar" i]',
    'input[name*="aadhaar" i]'
  ].join(', ');

  const dpr = window.devicePixelRatio || 1;
  return Array.from(document.querySelectorAll(selectors))
    .map(input => {
      const rect = input.getBoundingClientRect();
      return {
        x: Math.round(rect.left * dpr),
        y: Math.round(rect.top * dpr),
        w: Math.round(rect.width * dpr),
        h: Math.round(rect.height * dpr)
      };
    })
    .filter(box => box.w > 0 && box.h > 0);
}

if (!window.hasInjectedPrivacyAgent) {
  window.hasInjectedPrivacyAgent = true;

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'GET_PII_BOXES') {
      sendResponse({ boxes: getSensitiveDOMBoxes() });
    }
    return true;
  });
}
