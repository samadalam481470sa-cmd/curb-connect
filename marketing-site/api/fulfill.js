import { requireRelease } from '../lib/config.mjs';
import { issueDownloadToken } from '../lib/download-token.mjs';
import { requirePaidSession } from '../lib/stripe.mjs';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    requireRelease();
    const session = await requirePaidSession(req.body?.session_id);
    const token = issueDownloadToken(session.id);
    return res
      .status(200)
      .json({ downloadUrl: `/api/download?token=${encodeURIComponent(token)}` });
  } catch (error) {
    const expected = [400, 402, 403].includes(error.statusCode) && !error.type;
    return res.status(expected ? error.statusCode : 503).json({
      error: expected
        ? error.message
        : 'Verification is temporarily unavailable. Try again or contact support with your receipt.',
    });
  }
}
