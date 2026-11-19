import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RELEASE_FILENAME } from '../lib/config.mjs';
import { verifyDownloadToken } from '../lib/download-token.mjs';
import { requirePaidSession } from '../lib/stripe.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

function releasePath() {
  return (
    process.env.RELEASE_ZIP_PATH ||
    join(__dirname, '..', 'public', 'releases', RELEASE_FILENAME)
  );
}

/**
 * GET /api/download?token=...
 * Returns the Field Pro app zip only when the token is valid and Stripe still shows paid.
 */
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    if (!process.env.STRIPE_SECRET_KEY) {
      return res.status(503).json({
        error: 'Download is not configured. Set STRIPE_SECRET_KEY.',
        code: 'stripe_not_configured',
      });
    }

    const token =
      typeof req.query?.token === 'string'
        ? req.query.token
        : typeof req.url === 'string'
          ? new URL(req.url, 'http://localhost').searchParams.get('token')
          : null;

    const claims = verifyDownloadToken(token);
    await requirePaidSession(claims.sid);

    const file = releasePath();
    if (!existsSync(file)) {
      return res.status(503).json({
        error: 'Release package is not published yet. Contact support with your receipt.',
        code: 'release_missing',
      });
    }

    const { size } = statSync(file);
    const bytes = readFileSync(file);
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Length', String(size));
    res.setHeader('Content-Disposition', 'attachment; filename="Field-Pro-App.zip"');
    res.setHeader('X-Field-Pro-Session', claims.sid);
    return res.end(bytes);
  } catch (error) {
    const status = error.statusCode || 500;
    if (!res.headersSent) {
      return res.status(status).json({
        error: error.message || 'Download failed',
        code: error.code || 'download_failed',
      });
    }
  }
}
