import { describe, expect, it } from 'vitest';
import {
  CUSTOMER_STAGES,
  mailtoHref,
  shareMessage,
  smsHref,
  stageIndex,
  tokenFromHash,
} from './customerStatus';

const TOKEN = 'AbC_123-xyzAbC_123-xyzAbC_123-xyzAbC_123-x';

describe('customer job-status helpers', () => {
  it('reads the token from the fragment and rejects anything else', () => {
    expect(tokenFromHash(`#t=${TOKEN}`)).toBe(TOKEN);
    expect(tokenFromHash(`t=${TOKEN}`)).toBe(TOKEN);
    expect(tokenFromHash('')).toBeNull();
    expect(tokenFromHash('#t=short')).toBeNull();
    expect(tokenFromHash('#t=<script>alert(1)</script>aaaaaaaaaaaaaaaaaaaa')).toBeNull();
    expect(tokenFromHash(`#x=${TOKEN}`)).toBeNull();
  });

  it('orders stages and treats unknown stages as the first', () => {
    expect(CUSTOMER_STAGES.map((s) => s.key)).toEqual([
      'intake',
      'estimating',
      'scheduled',
      'in_progress',
      'completed',
    ]);
    expect(stageIndex('scheduled')).toBe(2);
    expect(stageIndex('completed')).toBe(4);
    expect(stageIndex('nope')).toBe(0);
  });

  it('builds a friendly message with or without names', () => {
    const url = 'https://app.example/track#t=abc';
    expect(
      shareMessage({ url, jobTitle: 'Roof', companyName: 'Acme', recipientName: 'Dana' }),
    ).toBe(
      'Hi Dana, Acme here. You can follow the progress of "Roof" any time at this link: https://app.example/track#t=abc',
    );
    expect(shareMessage({ url, jobTitle: 'Roof' })).toBe(
      'You can follow the progress of "Roof" any time at this link: https://app.example/track#t=abc',
    );
  });

  it('encodes text and email links so the fragment survives', () => {
    const url = 'https://app.example/track#t=abc';
    const sms = smsHref(shareMessage({ url, jobTitle: 'A & B' }));
    expect(sms.startsWith('sms:?&body=')).toBe(true);
    expect(decodeURIComponent(sms.slice('sms:?&body='.length))).toContain(url);
    expect(sms).not.toContain('#');
    const mail = mailtoHref({ url, jobTitle: 'A & B', email: 'dana@example.com' });
    expect(mail.startsWith('mailto:dana%40example.com?subject=')).toBe(true);
    expect(mail).not.toContain('#');
    expect(decodeURIComponent(mail)).toContain(url);
    expect(mailtoHref({ url, jobTitle: 'Roof' }).startsWith('mailto:?subject=')).toBe(true);
  });
});
