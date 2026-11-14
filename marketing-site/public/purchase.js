const sessionId = new URLSearchParams(window.location.search).get('session_id');
const statusElement = document.querySelector('#status');
const downloadButton = document.querySelector('#download-btn');
const retryButton = document.querySelector('#retry');
let downloadUrl;

async function verifyPurchase() {
  retryButton.hidden = true;
  statusElement.className = 'status';
  statusElement.textContent = 'Verifying payment…';
  try {
    const response = await fetch('/api/fulfill', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId }),
    });
    const data = await response.json();
    if (!response.ok || !data.downloadUrl) {
      throw new Error(data.error || 'Could not verify your payment.');
    }
    downloadUrl = data.downloadUrl;
    document.querySelector('h1').textContent = 'Your download is ready';
    statusElement.className = 'status ok';
    statusElement.textContent = 'Payment confirmed. You can download the Field Pro calculator now.';
    downloadButton.disabled = false;
  } catch (error) {
    statusElement.className = 'status error';
    statusElement.textContent = error.message;
    retryButton.hidden = false;
  }
}

downloadButton.addEventListener('click', () => window.location.assign(downloadUrl));
retryButton.addEventListener('click', verifyPurchase);

if (sessionId) {
  void verifyPurchase();
} else {
  statusElement.className = 'status error';
  statusElement.textContent = 'Open the confirmation page you reached after Stripe checkout.';
}
