-- Password reset by email (item 11): one-time links, stored as SHA-256 hashes, like
-- email_verifications (migration 0022). Platform-only: the tenant role gets no access, so a
-- company session can never read or forge another person's reset link.
CREATE TABLE IF NOT EXISTS public.password_resets (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
REVOKE ALL ON public.password_resets FROM fieldline_app;
