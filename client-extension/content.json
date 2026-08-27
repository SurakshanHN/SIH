// Function to get high-DPI adjusted bounding boxes of sensitive inputs
function getSensitiveDOMBoxes() {
  const inputs = document.querySelectorAll('input[type="password"], input[type="email"], input[autocomplete="cc-number"]');
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

// Listen for requests from background.js
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "GET_PII_BOXES") {
    sendResponse({ boxes: getSensitiveDOMBoxes() });
  }
});

