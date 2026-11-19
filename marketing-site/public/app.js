// Field Pro storefront: page effects, roof calculator and Stripe checkout.
document.documentElement.classList.add('js');

// Must match TERMS_VERSION in lib/config.mjs and the version on terms.html.
const TERMS_VERSION = '2026-11-14';

// Scroll progress bar
const bar = document.getElementById('progress');
addEventListener(
  'scroll',
  () => {
    const max = document.documentElement.scrollHeight - innerHeight;
    bar.style.width = (max > 0 ? (scrollY / max) * 100 : 0) + '%';
  },
  { passive: true },
);

// Reveal on scroll
const reveals = document.querySelectorAll('.reveal');
if ('IntersectionObserver' in window) {
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('in');
          io.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.12 },
  );
  reveals.forEach((el) => io.observe(el));
} else {
  reveals.forEach((el) => el.classList.add('in'));
}

// Count-up stats
document.querySelectorAll('[data-count]').forEach((el) => {
  const target = Number(el.dataset.count);
  const prefix = el.dataset.prefix || '';
  if (!target || !('IntersectionObserver' in window)) return;
  const obs = new IntersectionObserver(([entry]) => {
    if (!entry.isIntersecting) return;
    obs.disconnect();
    const start = performance.now();
    const tick = (now) => {
      const p = Math.min(1, (now - start) / 1200);
      el.textContent = prefix + Math.round(target * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  obs.observe(el);
});

// Roof calculator
const $ = (id) => document.getElementById(id);
function calc() {
  const footprint = Math.max(0, Number($('c-area').value) || 0);
  const pitch = Number($('c-pitch').value);
  const waste = Number($('c-waste').value) / 100;
  $('c-pitch-out').textContent = pitch + '/12';
  $('c-waste-out').textContent = Math.round(waste * 100) + '%';
  const area = footprint * Math.sqrt(1 + Math.pow(pitch / 12, 2));
  const squares = (area / 100) * (1 + waste);
  $('o-area').textContent = Math.round(area).toLocaleString() + ' ft²';
  $('o-sq').textContent = squares.toFixed(1);
  $('o-bundles').textContent = Math.ceil(squares * 3).toLocaleString();
}
['c-area', 'c-pitch', 'c-waste'].forEach((id) => $(id).addEventListener('input', calc));
calc();

// Checkout: the server creates a Stripe Checkout Session and returns its URL.
// Buyers agree to the terms by purchasing (notice under the button and on the Stripe page).
const errBox = $('buy-error');
const buyButtons = document.querySelectorAll('.buy-button');
buyButtons.forEach((btn) => {
  btn.addEventListener('click', async () => {
    const label = btn.textContent;
    buyButtons.forEach((b) => {
      b.disabled = true;
    });
    btn.textContent = 'Opening secure checkout…';
    errBox.hidden = true;
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acceptedTerms: true, termsVersion: TERMS_VERSION }),
      });
      const data = await res.json();
      if (!res.ok || !data.url) throw new Error(data.error || 'Checkout failed');
      window.location.assign(data.url);
    } catch (error) {
      errBox.textContent =
        error.message && error.message !== 'Checkout failed'
          ? error.message
          : "Couldn't open checkout. Please check your connection and try again.";
      errBox.hidden = false;
      $('pricing').scrollIntoView({ behavior: 'smooth' });
      buyButtons.forEach((b) => {
        b.disabled = false;
      });
      btn.textContent = label;
    }
  });
});
