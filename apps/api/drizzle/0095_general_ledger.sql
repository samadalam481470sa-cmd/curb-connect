-- 0095: general ledger (blueprint gap 3).
--   * gl_accounts: owner-editable chart of accounts (seeded template rows are
--     flagged is_template; the template is a starting point, not advice).
--   * gl_periods: posting periods with open/close.
--   * gl_journal_entries + gl_journal_lines: balanced journals. Draft ->
--     posted; posted entries are immutable in the API (corrections are
--     reversing entries with source='reversal').
-- This GL is separate from the payments settlement ledger (ledger_entries);
-- settlement entries are not auto-posted here.
CREATE TABLE public.gl_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  code text NOT NULL CHECK (length(code) BETWEEN 1 AND 20),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  type text NOT NULL CHECK (type IN ('asset','liability','equity','income','expense')),
  normal_balance text NOT NULL CHECK (normal_balance IN ('debit','credit')),
  active boolean NOT NULL DEFAULT true,
  is_template boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gl_accounts_org_id_id_uq UNIQUE (org_id, id),
  CONSTRAINT gl_accounts_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT,
  CONSTRAINT gl_accounts_org_id_code_uq UNIQUE (org_id, code)
);
--> statement-breakpoint
CREATE INDEX gl_accounts_org_id_idx ON public.gl_accounts(org_id);
--> statement-breakpoint
CREATE INDEX gl_accounts_org_id_type_sort_order_idx ON public.gl_accounts(org_id, type, sort_order);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('public.gl_accounts');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.gl_accounts TO fieldline_app, fieldline_platform;
--> statement-breakpoint
CREATE TABLE public.gl_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  starts_on date NOT NULL,
  ends_on date NOT NULL CHECK (ends_on >= starts_on),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  closed_at timestamptz,
  closed_by_user_id uuid,
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gl_periods_org_id_id_uq UNIQUE (org_id, id),
  CONSTRAINT gl_periods_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT,
  CONSTRAINT gl_periods_org_id_starts_on_uq UNIQUE (org_id, starts_on)
);
--> statement-breakpoint
CREATE INDEX gl_periods_org_id_idx ON public.gl_periods(org_id);
--> statement-breakpoint
CREATE INDEX gl_periods_org_id_status_idx ON public.gl_periods(org_id, status);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('public.gl_periods');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.gl_periods TO fieldline_app, fieldline_platform;
--> statement-breakpoint
CREATE TABLE public.gl_journal_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  entry_date date NOT NULL,
  memo text NOT NULL CHECK (length(memo) BETWEEN 1 AND 500),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','posted')),
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','reversal')),
  reversal_of_id uuid,
  period_id uuid,
  posted_at timestamptz,
  posted_by_user_id uuid,
  created_by_user_id uuid,
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gl_journal_entries_org_id_id_uq UNIQUE (org_id, id),
  CONSTRAINT gl_journal_entries_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT,
  CONSTRAINT gl_journal_entries_reversal_of_id_fk FOREIGN KEY (org_id, reversal_of_id) REFERENCES public.gl_journal_entries(org_id, id) ON DELETE RESTRICT,
  CONSTRAINT gl_journal_entries_period_id_fk FOREIGN KEY (org_id, period_id) REFERENCES public.gl_periods(org_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX gl_journal_entries_org_id_idx ON public.gl_journal_entries(org_id);
--> statement-breakpoint
CREATE INDEX gl_journal_entries_org_id_status_entry_date_idx ON public.gl_journal_entries(org_id, status, entry_date);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('public.gl_journal_entries');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.gl_journal_entries TO fieldline_app, fieldline_platform;
--> statement-breakpoint
CREATE TABLE public.gl_journal_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  entry_id uuid NOT NULL,
  account_id uuid NOT NULL,
  direction text NOT NULL CHECK (direction IN ('debit','credit')),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  memo text CHECK (memo IS NULL OR length(memo) <= 300),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gl_journal_lines_org_id_id_uq UNIQUE (org_id, id),
  CONSTRAINT gl_journal_lines_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT,
  CONSTRAINT gl_journal_lines_entry_id_fk FOREIGN KEY (org_id, entry_id) REFERENCES public.gl_journal_entries(org_id, id) ON DELETE CASCADE,
  CONSTRAINT gl_journal_lines_account_id_fk FOREIGN KEY (org_id, account_id) REFERENCES public.gl_accounts(org_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX gl_journal_lines_org_id_idx ON public.gl_journal_lines(org_id);
--> statement-breakpoint
CREATE INDEX gl_journal_lines_org_id_entry_id_idx ON public.gl_journal_lines(org_id, entry_id);
--> statement-breakpoint
CREATE INDEX gl_journal_lines_org_id_account_id_idx ON public.gl_journal_lines(org_id, account_id);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('public.gl_journal_lines');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.gl_journal_lines TO fieldline_app, fieldline_platform;
