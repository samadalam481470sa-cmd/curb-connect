// Password reset by email (item 11). The link carries a random token; only its SHA-256 hash is
// stored (password_resets, migration 0030), the token is single-use and short-lived. The message
// goes through the same mail adapter and legal footer as every other email. Until SMTP is
// configured the flow reports that honestly instead of pretending a link was sent.
import { createHash, randomBytes } from 'node:crypto';
import { withLegalFooter, type MailAdapter } from './mail';

export const RESET_TTL_MS = 60 * 60 * 1000;

export function generateResetToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashResetToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Whether reset email can actually leave this server. Mirrors the sign-up rule in
 * modules/auth/passwordRoutes.ts: the dev outbox without an SMTP URL records mail, it does not
 * send it, so a reset link would never reach the person.
 */
export function isResetEmailConfigured(mailName: string | undefined, smtpUrl: string | undefined): boolean {
  if (!mailName) return false;
  return !(mailName === 'dev-outbox' && smtpUrl === undefined);
}

export async function sendPasswordResetEmail(
  mail: MailAdapter,
  opts: { to: string; token: string; tokenId: string; appOrigin: string; postalAddress: string | undefined },
): Promise<void> {
  const link = `${opts.appOrigin.replace(/\/$/, '')}/reset-password?token=${encodeURIComponent(opts.token)}`;
  const message = withLegalFooter(
    {
      to: opts.to,
      subject: 'Reset your Curb Connect password',
      text: [
        'Use this link to choose a new password for your Curb Connect account.',
        '',
        `Open this link within 1 hour: ${link}`,
        '',
        'The link works once. If you did not ask to reset your password, ignore this email — your password stays the same.',
      ].join('\n'),
      idempotencyKey: `password-reset-${opts.tokenId}`,
    },
    { appOrigin: opts.appOrigin, postalAddress: opts.postalAddress },
  );
  await mail.send(message);
}
