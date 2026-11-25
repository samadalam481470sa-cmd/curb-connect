// Production registration must never silently claim ownership of an unverified mailbox.
// A development/test outbox is allowed only outside production; it never sends real email.
export type RegistrationEnvironment = 'development' | 'test' | 'production';
export type RegistrationMailTransport = 'dev-outbox' | 'smtp';

export function passwordRegistrationPolicy(
  env: RegistrationEnvironment,
  mailTransport: RegistrationMailTransport,
): { allowed: boolean; autoVerify: boolean } {
  const autoVerify = env !== 'production' && mailTransport === 'dev-outbox';
  return {
    allowed: env !== 'production' || mailTransport === 'smtp',
    autoVerify,
  };
}
