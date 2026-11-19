// Prints fresh values for the two random secrets. Paste them into apps/mailer/.env.local, and put
// the same MAILER_SHARED_SECRET into apps/api/.env.local. Nothing is written to disk by this script.
import { randomBytes } from 'node:crypto';

console.log(`MAILER_SHARED_SECRET=${randomBytes(48).toString('base64url')}`);
console.log(`MAILER_TOKEN_ENCRYPTION_KEY=${randomBytes(32).toString('base64')}`);
