function getSensitiveDOMBoxes() {
  // Expanded to catch names, addresses, and common Indian IDs
  const selectors = [
    'input[type="password"]',
    'input[type="email"]',
    'input[type="tel"]',
    'input[autocomplete="cc-number"]',
    'input[autocomplete="name"]',
    'input[autocomplete="street-address"]',
    'input[name*="ssn"]',
    'input[name*="pan"]',
    'input[name*="aadhar"]'
  ].join(', ');

  const inputs = document.querySelectorAll(selectors);
  const dpr = window.devicePixelRatio || 1;

  const boxes = Array.from(inputs).map(input => {
    const rect = input.getBoundingClientRect();
    return {
      x: Math.round(rect.left * dpr),
      y: Math.round(rect.top * dpr),
      w: Math.round(rect.width * dpr),
      h: Math.round(rect.height * dpr)
    };
  });

  console.log("Found Sensitive DOM Bounding Boxes:", boxes);
  return boxes;
}

// Safety Check: Because background.js injects this file every time the icon 
// is clicked, we must prevent multiple message listeners from piling up.
if (!window.hasInjectedPrivacyAgent) {
  window.hasInjectedPrivacyAgent = true;
  
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "GET_PII_BOXES") {
      sendResponse({ boxes: getSensitiveDOMBoxes() });
    }
  });
}
