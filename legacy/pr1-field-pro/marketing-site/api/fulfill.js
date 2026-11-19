import { PACKAGE_SKU } from '../lib/config.mjs';
import { issueDownloadToken } from '../lib/download-token.mjs';
import { requirePaidSession } from '../lib/stripe.mjs';

/**
 * POST /api/fulfill
 * Body: { session_id }
 * Verifies the Checkout Session is paid, then issues a short-lived download token.
 */
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    return res.status(503).json({
      error: 'Download fulfillment is not configured yet. Set STRIPE_SECRET_KEY on the site.',
      code: 'stripe_not_configured',
    });
  }

  try {
    const sessionId =
      (req.body && (req.body.session_id || req.body.sessionId)) ||
      (typeof req.query?.session_id === 'string' ? req.query.session_id : null);

    const session = await requirePaidSession(sessionId);
    const email = session.customer_details?.email || session.customer_email || null;
    const token = issueDownloadToken(session.id, email);

    return res.status(200).json({
      ok: true,
      sku: PACKAGE_SKU,
      sessionId: session.id,
      email,
      amountTotal: session.amount_total,
      currency: session.currency,
      paymentStatus: session.payment_status,
      downloadToken: token,
      downloadUrl: `/api/download?token=${encodeURIComponent(token)}`,
      expiresInSeconds: 60 * 60 * 24,
    });
  } catch (error) {
    const status = error.statusCode || 500;
    return res.status(status).json({
      error: error.message || 'Fulfillment failed',
      code: error.code || 'fulfill_failed',
    });
  }
}
