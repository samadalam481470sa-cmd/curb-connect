-- Invoices sent from a chosen mailbox address (a member can connect several Gmail / Outlook
-- addresses through apps/mailer).
-- email_via held only 'gmail' or 'outlook'. A member can now connect several addresses, so it may
-- also name one mailbox: '<provider>:<address>' (the bare provider still means "my default there").
ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_email_via_ck;
--> statement-breakpoint
ALTER TABLE public.invoices ADD CONSTRAINT invoices_email_via_ck
  CHECK (email_via IS NULL OR (length(email_via) <= 270 AND email_via ~ '^(gmail|outlook)(:[^[:space:]]+@[^[:space:]]+)?$'));
