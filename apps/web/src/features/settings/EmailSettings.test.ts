import { describe, expect, it } from 'vitest';
import type { MailboxList, MeResponse } from '@fieldline/contracts';
import { mailboxDescription } from '../billing/BillingView';
import { CONNECT_ERRORS, connectResult, providerLabel, suggestMailbox } from './EmailSettings';

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

const me = (signIn: MeResponse['signIn'], email: string | null = null) =>
  ({ user: { email }, signIn }) as unknown as MeResponse;
const list = (items: Partial<MailboxList['items'][number]>[] = []): MailboxList => ({
  available: true,
  providers: { gmail: true, outlook: true },
  defaultProvider: null,
  defaultMailboxId: null,
  items: items as MailboxList['items'],
});

describe('suggestMailbox', () => {
  it('offers the Gmail someone signed in with, until it is connected', () => {
    const who = me({ method: 'google', email: 'Crew@Gmail.com' });
    expect(suggestMailbox(who, list())).toMatchObject({
      provider: 'gmail',
      email: 'crew@gmail.com',
    });
    expect(suggestMailbox(who, list([{ id: 'gmail:crew@gmail.com' }]))).toBeNull();
  });
  it('offers Outlook after a Microsoft sign-in, and guesses from a password account email', () => {
    expect(
      suggestMailbox(me({ method: 'microsoft', email: 'a@contoso.com' }), list())?.provider,
    ).toBe('outlook');
    expect(
      suggestMailbox(me({ method: 'password', email: null }, 'b@hotmail.com'), list())?.provider,
    ).toBe('outlook');
    expect(
      suggestMailbox(me({ method: 'password', email: null }, 'b@company.com'), list()),
    ).toBeNull();
  });
  it('offers nothing when that provider is not set up', () => {
    const off = { ...list(), providers: { gmail: false, outlook: true } };
    expect(suggestMailbox(me({ method: 'google', email: 'x@gmail.com' }), off)).toBeNull();
  });
});

describe('mailboxDescription', () => {
  const mailboxes = list([
    { id: 'gmail:a@gmail.com', provider: 'gmail', email: 'a@gmail.com', isDefault: true },
    { id: 'gmail:b@gmail.com', provider: 'gmail', email: 'b@gmail.com', isDefault: false },
  ]);
  it('names the chosen address, else the default one', () => {
    expect(mailboxDescription('gmail:b@gmail.com', mailboxes)).toBe('Gmail b@gmail.com');
    expect(mailboxDescription(null, mailboxes)).toBe('Gmail a@gmail.com');
    expect(mailboxDescription('outlook', mailboxes)).toBe('your Outlook');
  });
});
