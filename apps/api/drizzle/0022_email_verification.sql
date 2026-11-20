-- Email verification for password accounts, and the trial that waits for it.
--
-- users.email_verified_at: set when the person opens the link we emailed. Accounts that existed before
-- this migration are treated as verified so no current customer is affected.
-- organizations.trial_pending: the company was created by an unverified person whose address is
-- eligible for a trial. The trial starts when that person verifies (see services/email-verification).
-- email_verifications: one-time links, stored as SHA-256 hashes. Platform-only.
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS email_verified_at timestamptz;
--> statement-breakpoint
UPDATE public.users SET email_verified_at = now() WHERE email_verified_at IS NULL;
--> statement-breakpoint
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS trial_pending boolean NOT NULL DEFAULT false;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.email_verifications (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
REVOKE ALL ON public.email_verifications FROM fieldline_app;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.fieldline_protect_billing_fields()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_user = 'fieldline_app' THEN
    IF TG_OP = 'INSERT' THEN
      NEW.billing_exempt := false;
      NEW.trial_ends_at := now() + interval '7 days';
      NEW.activated_until := NULL;
      NEW.trial_pending := false;
    ELSIF NEW.trial_ends_at IS DISTINCT FROM OLD.trial_ends_at
       OR NEW.billing_exempt IS DISTINCT FROM OLD.billing_exempt
       OR NEW.activated_until IS DISTINCT FROM OLD.activated_until
       OR NEW.trial_pending IS DISTINCT FROM OLD.trial_pending THEN
      RAISE EXCEPTION 'billing fields can only be changed by the platform'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
