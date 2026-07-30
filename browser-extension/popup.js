const captureButton = document.getElementById('captureButton');
const copyButton = document.getElementById('copyButton');
const output = document.getElementById('output');
const status = document.getElementById('status');
const sendButton = document.getElementById('sendButton');
const popupBackendUrl = document.getElementById('popupBackendUrl');

captureButton.addEventListener('click', async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'JOB_TRACKER_CAPTURE' });

    if (!response?.ok) {
      status.textContent = response?.error || 'Capture failed.';
      return;
    }

    output.value = JSON.stringify(response.payload, null, 2);
    status.textContent = 'Captured job details from the page.';
    // prefill backend url from storage
    chrome.storage.local.get(['jobTrackerBackendUrl'], (res) => {
      if (res?.jobTrackerBackendUrl) popupBackendUrl.value = res.jobTrackerBackendUrl;
    });
  } catch (error) {
    status.textContent = `Capture failed: ${error.message}`;
  }
});

copyButton.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(output.value);
    status.textContent = 'JSON copied to clipboard.';
  } catch (error) {
    status.textContent = `Copy failed: ${error.message}`;
  }
});

sendButton.addEventListener('click', async () => {
  try {
    const json = output.value && JSON.parse(output.value);
    if (!json) {
      status.textContent = 'No JSON to send. Capture first.';
      return;
    }

    const backend = popupBackendUrl.value && popupBackendUrl.value.trim();
    if (!backend) {
      status.textContent = 'Enter backend URL first.';
      return;
    }

    // persist backend URL for convenience
    chrome.storage.local.set({ jobTrackerBackendUrl: backend }, () => {});

    // send as a snapshot replace (single-item applications array) so both
    // the FastAPI and legacy stdlib backend can accept it via /sync
    const payload = { applications: [json], history: [], syncedAt: new Date().toISOString() };
    const res = await fetch(new URL('/sync', backend).toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text();
      status.textContent = `Send failed: ${res.status} ${text}`;
      return;
    }

    const body = await res.json();
    status.textContent = body?.ok ? 'Sent to backend.' : `Backend replied: ${JSON.stringify(body)}`;
  } catch (err) {
    status.textContent = `Send failed: ${err.message}`;
  }
});

// populate saved backend url on open
chrome.storage.local.get(['jobTrackerBackendUrl'], (res) => {
  if (res?.jobTrackerBackendUrl) popupBackendUrl.value = res.jobTrackerBackendUrl;
});
