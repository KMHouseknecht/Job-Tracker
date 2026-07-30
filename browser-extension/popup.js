const captureButton = document.getElementById('captureButton');
const copyButton = document.getElementById('copyButton');
const output = document.getElementById('output');
const status = document.getElementById('status');

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
