import { describe, expect, it } from 'vitest';
import { CONNECT_ERRORS, connectResult, providerLabel } from './EmailSettings';

describe('connectResult', () => {
  it('asks the page to confirm a finished sign-in with the signed-in session', () => {
    expect(
      connectResult('?mailbox=confirm&provider=gmail&pending=abc123abc123abc123abc123'),
    ).toEqual({
      kind: 'confirm',
      provider: 'gmail',
      pending: 'abc123abc123abc123abc123',
    });
    expect(providerLabel('outlook')).toBe('Outlook');
    expect(providerLabel('evil')).toBe('Mailbox');
  });

  it('explains each failure the mail server reports', () => {
    expect(connectResult('?mailbox=error&reason=missing_permission')).toEqual({
      kind: 'message',
      tone: 'danger',
      message: CONNECT_ERRORS.missing_permission,
    });
    const declined = connectResult('?mailbox=error&reason=declined');
    expect(declined?.kind === 'message' && declined.message).toBe(CONNECT_ERRORS.declined);
  });

  it('falls back to a generic message for an unknown reason or a confirm without an id', () => {
    const odd = connectResult('?mailbox=error&reason=<script>');
    expect(odd?.kind === 'message' && odd.message).toBe(CONNECT_ERRORS.provider_error);
    expect(connectResult('?mailbox=confirm&provider=gmail')?.kind).toBe('message');
  });

  it('ignores pages that did not come back from sign-in', () => {
    expect(connectResult('')).toBeNull();
    expect(connectResult('?tab=1')).toBeNull();
  });
});
