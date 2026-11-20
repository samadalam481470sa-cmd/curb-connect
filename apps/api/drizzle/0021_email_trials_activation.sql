-- One free trial per email address, and activation codes.
--
-- trial_claims: a normalised email (see services/trial-email.ts) that has already received a free trial.
-- The row outlives the company and the account, so deleting a company or signing up again with the same
-- address does not restart the week. Only platform code writes it.
--
-- activation_codes: owner-issued codes. Only a SHA-256 hash of each code is stored; the plain code is
-- shown once when it is generated. Redeeming a code extends organizations.activated_until.
CREATE TABLE IF NOT EXISTS public.trial_claims (
  email_key text PRIMARY KEY,
  first_org_id uuid NOT NULL,
  claimed_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.activation_codes (
  id uuid PRIMARY KEY,
  code_hash text NOT NULL UNIQUE,
  label text NOT NULL DEFAULT '',
  grant_days integer NOT NULL CHECK (grant_days BETWEEN 1 AND 3650),
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  redeemed_at timestamptz,
  redeemed_org_id uuid,
  redeemed_by_user_id uuid
);
--> statement-breakpoint
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS activated_until timestamptz;
--> statement-breakpoint
REVOKE ALL ON public.trial_claims, public.activation_codes FROM fieldline_app;
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
    ELSIF NEW.trial_ends_at IS DISTINCT FROM OLD.trial_ends_at
       OR NEW.billing_exempt IS DISTINCT FROM OLD.billing_exempt
       OR NEW.activated_until IS DISTINCT FROM OLD.activated_until THEN
      RAISE EXCEPTION 'billing fields can only be changed by the platform'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
