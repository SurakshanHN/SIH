async function scanActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id) {
    throw new Error('No active tab found.');
  }

  try {
    return await chrome.tabs.sendMessage(tab.id, { action: 'GET_PII_BOXES' });
  } catch {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    return await chrome.tabs.sendMessage(tab.id, { action: 'GET_PII_BOXES' });
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'SCAN_ACTIVE_TAB') {
    scanActiveTab()
      .then(response => sendResponse({ ok: true, ...response }))
      .catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }
});

chrome.action.onClicked.addListener(() => {
  scanActiveTab().catch(() => undefined);
});
