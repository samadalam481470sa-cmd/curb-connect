-- Trial and access control. A new company gets a 7-day trial that starts on the database clock.
-- After the trial a company can only use the product with an active subscription. Companies that
-- existed before this migration are grandfathered (billing_exempt) so no current customer is locked out.
--
-- Tamper protection: the tenant role (fieldline_app) can neither set nor change these two columns, and
-- it cannot choose a trial length on insert. Only platform code (fieldline_platform, used by org creation
-- and billing webhooks) or a migration may change them.
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz,
  ADD COLUMN IF NOT EXISTS billing_exempt boolean NOT NULL DEFAULT false;
-- New companies start a 7-day trial. Platform code may set this explicitly (for example to no trial).
ALTER TABLE public.organizations ALTER COLUMN trial_ends_at SET DEFAULT (now() + interval '7 days');
--> statement-breakpoint
-- Every organization that exists now predates the trial: grandfather it and clear the trial clock.
UPDATE public.organizations SET billing_exempt = true, trial_ends_at = NULL;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.fieldline_protect_billing_fields()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_user = 'fieldline_app' THEN
    IF TG_OP = 'INSERT' THEN
      -- The tenant role never picks its own trial or exemption.
      NEW.billing_exempt := false;
      NEW.trial_ends_at := now() + interval '7 days';
    ELSIF NEW.trial_ends_at IS DISTINCT FROM OLD.trial_ends_at
       OR NEW.billing_exempt IS DISTINCT FROM OLD.billing_exempt THEN
      RAISE EXCEPTION 'billing fields can only be changed by the platform'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS organizations_protect_billing ON public.organizations;
--> statement-breakpoint
CREATE TRIGGER organizations_protect_billing
  BEFORE INSERT OR UPDATE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.fieldline_protect_billing_fields();
