// Username and password sign-in for Field Pro, next to Microsoft and Google sign-in.
// Passwords are never stored: the API keeps a salted scrypt hash in password_credentials.
// Pure module: no I/O.
import { z } from 'zod';
import { MailAddressSchema } from './mailboxes';

export const USERNAME_PATTERN = /^[A-Za-z0-9._-]{3,32}$/;
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 200;

export const UsernameSchema = z
  .string()
  .trim()
  .regex(USERNAME_PATTERN, 'Use 3 to 32 letters, numbers, dots, dashes or underscores.');

export const PasswordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters.`)
  .max(PASSWORD_MAX_LENGTH, `Use at most ${PASSWORD_MAX_LENGTH} characters.`);

const COMMON_PASSWORDS = new Set([
  'password',
  'password1',
  'password12',
  'password123',
  '12345678',
  '123456789',
  '1234567890',
  'qwerty123',
  'qwertyuiop',
  'iloveyou',
  'letmein123',
  'welcome123',
  'admin123',
  'abc12345',
  '11111111',
  '00000000',
  'fieldpro123',
  'curbconnect',
]);

/** Returns what is wrong with a new password, or null when it is acceptable. */
export function passwordProblem(password: string, username?: string | null): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Use at least ${PASSWORD_MIN_LENGTH} characters for the password.`;
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return `Use at most ${PASSWORD_MAX_LENGTH} characters for the password.`;
  }
  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    return 'That password is too common. Pick another.';
  }
  if (username && password.toLowerCase() === username.toLowerCase()) {
    return 'The password cannot be the same as the username.';
  }
  return null;
}

export const PasswordSignUpRequestSchema = z.object({
  displayName: z.string().trim().min(1, 'Enter your full name.').max(120),
  username: UsernameSchema,
  email: MailAddressSchema,
  phone: z
    .string()
    .trim()
    .max(40)
    .regex(/^[0-9+()\-. xext]*$/i, 'Use only numbers and + ( ) - . in the phone number.')
    .optional(),
  password: PasswordSchema,
  /** Keep the session cookie after the browser closes (up to the session's absolute limit). */
  remember: z.boolean().default(true),
  returnTo: z.string().max(1000).optional(),
});
export type PasswordSignUpRequest = z.input<typeof PasswordSignUpRequestSchema>;

export const PasswordSignInRequestSchema = z.object({
  /** Username or email address. */
  login: z.string().trim().min(1, 'Enter your username or email.').max(254),
  password: z.string().min(1, 'Enter your password.').max(PASSWORD_MAX_LENGTH),
  remember: z.boolean().default(true),
  returnTo: z.string().max(1000).optional(),
});
export type PasswordSignInRequest = z.input<typeof PasswordSignInRequestSchema>;

export const PasswordSignInResponseSchema = z.object({
  /** Same-site path the browser should open next. */
  redirectTo: z.string(),
});

export const PasswordStatusSchema = z.object({
  hasPassword: z.boolean(),
  username: z.string().nullable(),
});
export type PasswordStatus = z.infer<typeof PasswordStatusSchema>;

export const SetPasswordRequestSchema = z.object({
  /** Required when a password already exists. */
  currentPassword: z.string().max(PASSWORD_MAX_LENGTH).optional(),
  newPassword: PasswordSchema,
  /** Required the first time a password is added to a Microsoft / Google account. */
  username: UsernameSchema.optional(),
});
export type SetPasswordRequest = z.input<typeof SetPasswordRequestSchema>;
