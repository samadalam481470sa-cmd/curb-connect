import { describe, expect, it } from 'vitest';
import { SIGN_IN_ERRORS } from './SignInView';
import { signUpProblems } from './SignUpView';

const good = {
  displayName: 'Sam Alam',
  username: 'samroofing',
  email: 'sam@example.com',
  phone: '(469) 555-0100',
  password: 'curbs-and-roofs-2026',
  confirm: 'curbs-and-roofs-2026',
  ageConfirmed: true,
};

describe('signUpProblems', () => {
  it('accepts a complete form', () => {
    expect(signUpProblems(good)).toEqual({});
  });
  it('flags each bad field', () => {
    expect(
      signUpProblems({
        displayName: ' ',
        username: 'x',
        email: 'nope',
        phone: 'call me',
        password: 'password123',
        confirm: '',
        ageConfirmed: true,
      }),
    ).toEqual({
      displayName: expect.any(String),
      username: expect.any(String),
      email: expect.any(String),
      phone: expect.any(String),
      password: expect.stringContaining('too common'),
    });
    expect(signUpProblems({ ...good, confirm: 'other-password-1' }).confirm).toContain('match');
  });
  it('blocks submit until the 18-or-older box is ticked', () => {
    expect(signUpProblems({ ...good, ageConfirmed: false }).ageConfirmed).toContain('18 or older');
    expect(signUpProblems(good).ageConfirmed).toBeUndefined();
  });
  it('explains every error the API can send back from Microsoft or Google sign-in', () => {
    expect(Object.keys(SIGN_IN_ERRORS)).toEqual(
      expect.arrayContaining(['account_link_required', 'sign_in_rejected', 'provider_denied']),
    );
  });
});
