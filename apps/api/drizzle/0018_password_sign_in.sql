-- Username and password sign-in.
--
-- password_credentials is global like users and sessions (no org_id, no RLS): a person signs in
-- once and may belong to several companies. Only a salted scrypt hash is stored, never a password.
-- Usernames are unique without regard to case.
CREATE TABLE public.password_credentials (
  user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  username text NOT NULL CHECK (username ~ '^[A-Za-z0-9._-]{3,32}$'),
  password_hash text NOT NULL CHECK (password_hash LIKE 'scrypt$%'),
  failed_attempts integer NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  locked_until timestamptz,
  password_changed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX password_credentials_username_uq ON public.password_credentials (lower(username));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.password_credentials TO fieldline_app, fieldline_platform;
