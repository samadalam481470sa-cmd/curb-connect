import { readFile } from 'node:fs/promises';
import { releasePath } from '../lib/config.mjs';
import { verifyDownloadToken } from '../lib/download-token.mjs';
import { requirePaidSession } from '../lib/stripe.mjs';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { sid } = verifyDownloadToken(req.query?.token);
    await requirePaidSession(sid);
    const bytes = await readFile(releasePath);
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="Field-Pro-App.zip"');
    return res.end(bytes);
  } catch (error) {
    const denied = [400, 401, 402, 403].includes(error.statusCode) && !error.type;
    return res.status(denied ? error.statusCode : 503).json({
      error: denied ? error.message : 'Download unavailable. Retry from the confirmation page.',
    });
  }
}
