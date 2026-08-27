const count = document.querySelector('#count');
const note = document.querySelector('#summary-note');
const boxList = document.querySelector('#box-list');
const scanButton = document.querySelector('#scan-button');

function formatCategory(category) {
  if (!category) return 'Unknown';
  
  const specialCaps = {
    'ssn': 'SSN',
    'pan': 'PAN',
    'cvv/security code': 'CVV/Security Code',
    'aadhaar': 'Aadhaar',
  };
  
  if (specialCaps[category.toLowerCase()]) {
    return specialCaps[category.toLowerCase()];
  }
  
  return category
    .split(' ')
    .map(word => {
      if (word.includes('/')) {
        return word.split('/').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('/');
      }
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
}

function renderBoxes(boxes) {
  count.textContent = boxes.length;
  note.textContent = boxes.length === 1 
    ? 'One field needs attention' 
    : boxes.length 
      ? 'Fields need attention' 
      : 'Nothing sensitive detected';
  
  boxList.replaceChildren();

  if (!boxes.length) {
    const empty = document.createElement('li');
    empty.className = 'empty';
    empty.textContent = 'No matching fields on this page.';
    boxList.append(empty);
    return;
  }

  boxes.forEach(box => {
    const item = document.createElement('li');
    const confidencePct = Math.round((box.confidence || 1) * 100);
    const categoryName = formatCategory(box.category);
    
    // UI displays category and dimensions clearly
    item.textContent = `${categoryName} (${confidencePct}%) | x ${box.x} y ${box.y} | ${box.w}x${box.h}`;
    boxList.append(item);
  });
}

async function scan() {
  scanButton.disabled = true;
  count.textContent = '...';
  note.textContent = 'Reading page structure';

  chrome.runtime.sendMessage({ action: 'SCAN_ACTIVE_TAB' }, response => {
    scanButton.disabled = false;
    if (chrome.runtime.lastError || !response?.ok) {
      count.textContent = '!';
      note.textContent = response?.error || 'This page cannot be inspected';
      boxList.replaceChildren();
      return;
    }
    renderBoxes(response.boxes || []);
  });
}

// Support real-time updates from content script
chrome.runtime.onMessage.addListener((request) => {
  if (request.action === 'FIELDS_UPDATED') {
    renderBoxes(request.boxes || []);
  }
});

scanButton.addEventListener('click', scan);
scan();
