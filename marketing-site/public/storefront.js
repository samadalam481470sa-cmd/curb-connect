const form = document.querySelector('#estimate-form');
const trade = document.querySelector('#trade');
const quantity = document.querySelector('#quantity');
const rate = document.querySelector('#rate');
const subtotal = document.querySelector('#subtotal');
const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

function updateSubtotal() {
  subtotal.value =
    quantity.validity.valid && rate.validity.valid
      ? currency.format(quantity.valueAsNumber * rate.valueAsNumber)
      : 'Enter valid measurements and prices';
}

form.addEventListener('submit', (event) => event.preventDefault());
form.addEventListener('input', updateSubtotal);
trade.addEventListener('change', () => {
  const roofing = trade.value === 'roof';
  document.querySelector('#quantity-label').textContent = roofing
    ? 'Roof area (sq ft)'
    : 'Curb length (linear ft)';
  document.querySelector('#rate-label').textContent = roofing
    ? 'Cost per sq ft ($)'
    : 'Cost per linear ft ($)';
  quantity.value = roofing ? '1800' : '25';
  rate.value = roofing ? '4.50' : '32.00';
  updateSubtotal();
});

const checkoutButton = document.querySelector('#checkout-button');
const alertBox = document.querySelector('#payment-alert');
const alertText = document.querySelector('#payment-alert-text');
const defaultLabel = checkoutButton.textContent;

checkoutButton.addEventListener('click', async () => {
  checkoutButton.disabled = true;
  checkoutButton.textContent = 'Opening checkout…';
  alertBox.hidden = true;
  try {
    const response = await fetch('/api/checkout', { method: 'POST' });
    const data = await response.json();
    if (!response.ok || !data.url) throw new Error(data.error);
    window.location.assign(data.url);
  } catch {
    alertText.textContent = 'Checkout is temporarily unavailable. Please try again later.';
    alertBox.hidden = false;
    checkoutButton.disabled = false;
    checkoutButton.textContent = defaultLabel;
  }
});
