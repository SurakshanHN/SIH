chrome.action.onClicked.addListener(async (tab) => {
  // 1. Get DOM coordinates from the active tab
  const response = await chrome.tabs.sendMessage(tab.id, { action: "GET_PII_BOXES" });
  console.log("Received Bounding Boxes in Background:", response.boxes);

  // 2. Capture tab screenshot as Data URL (PNG)
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
  console.log("Captured Screenshot Payload (Base64 string length):", dataUrl.length);

  // TODO LATER: Pass dataUrl and response.boxes into Rust Wasm module to redact!
});
