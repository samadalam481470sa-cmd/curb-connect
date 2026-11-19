-- Invoice email delivery. An invoice can be emailed (PDF attached) from the issuing member's own
-- Gmail or Outlook through the separate mail server (apps/mailer). Only the outcome is stored here;
-- OAuth tokens live in the mail server and never reach this database. Existing RLS policies on
-- invoices already cover the new columns.
ALTER TABLE public.invoices ADD COLUMN recipient_email text;
--> statement-breakpoint
ALTER TABLE public.invoices ADD COLUMN email_via text;
--> statement-breakpoint
ALTER TABLE public.invoices ADD COLUMN email_status text;
--> statement-breakpoint
ALTER TABLE public.invoices ADD COLUMN email_from text;
--> statement-breakpoint
ALTER TABLE public.invoices ADD COLUMN email_sent_at timestamptz;
--> statement-breakpoint
ALTER TABLE public.invoices ADD COLUMN email_error text;
--> statement-breakpoint
ALTER TABLE public.invoices ADD COLUMN email_sender_user_id uuid;
--> statement-breakpoint
ALTER TABLE public.invoices ADD COLUMN email_attempt integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE public.invoices ADD CONSTRAINT invoices_email_via_ck
  CHECK (email_via IS NULL OR email_via IN ('gmail', 'outlook'));
--> statement-breakpoint
ALTER TABLE public.invoices ADD CONSTRAINT invoices_email_status_ck
  CHECK (email_status IS NULL OR email_status IN ('queued', 'sent', 'failed', 'unknown'));
--> statement-breakpoint
ALTER TABLE public.invoices ADD CONSTRAINT invoices_recipient_email_ck
  CHECK (recipient_email IS NULL OR (length(recipient_email) <= 254 AND recipient_email LIKE '%_@_%._%'));
