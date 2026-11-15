-- Google as a sign-in provider. Identities stay keyed by (issuer, subject); the enum value only labels
-- which provider created the row. ADD VALUE is allowed inside the migration transaction on PG 12+
-- because nothing in this migration uses the new value.
ALTER TYPE "public"."identity_provider" ADD VALUE IF NOT EXISTS 'google';
