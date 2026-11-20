// Email verification for password accounts. The link carries a random token; only its SHA-256 hash is
// stored, the token is single-use and expires. The message goes through the same mail adapter and
// legal footer as every other email.
import { createHash, randomBytes } from 'node:crypto';
import { withLegalFooter, type MailAdapter } from './mail';

export const VERIFICATION_TTL_MS = 48 * 60 * 60 * 1000;

export function generateVerificationToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashVerificationToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function sendVerificationEmail(
  mail: MailAdapter,
  opts: { to: string; token: string; tokenId: string; appOrigin: string; postalAddress: string | undefined },
): Promise<void> {
  const link = `${opts.appOrigin.replace(/\/$/, '')}/verify-email?token=${encodeURIComponent(opts.token)}`;
  const message = withLegalFooter(
    {
      to: opts.to,
      subject: 'Confirm your email for Curb Connect',
      text: [
        'Confirm this email address to start your free trial.',
        '',
        `Open this link within 48 hours: ${link}`,
        '',
        "If you did not create a Curb Connect account, ignore this email. No account changes without this link.",
      ].join('\n'),
      idempotencyKey: `email-verify-${opts.tokenId}`,
    },
    { appOrigin: opts.appOrigin, postalAddress: opts.postalAddress },
  );
  await mail.send(message);
}
