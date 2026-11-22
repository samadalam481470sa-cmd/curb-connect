-- Invoice Intelligence (additive): bulk invoice import batches, source files, imported invoice
-- records with field evidence and review state, imported payments and saved mapping profiles.
-- Existing invoices, bills and payments tables are not changed. Money is integer minor units.
CREATE TABLE public.invoice_import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  created_by_user_id uuid,
  source_platform text NOT NULL DEFAULT 'other' CHECK (length(source_platform) <= 60),
  direction_hint text NOT NULL DEFAULT 'auto' CHECK (direction_hint IN ('auto','receivable','payable','mixed')),
  status text NOT NULL DEFAULT 'uploaded' CHECK (status IN ('uploaded','processing','needs_mapping','needs_review','completed','completed_with_warnings','failed','cancelled')),
  file_count integer NOT NULL DEFAULT 0,
  rejected_count integer NOT NULL DEFAULT 0,
  record_count integer NOT NULL DEFAULT 0,
  needs_review_count integer NOT NULL DEFAULT 0,
  imported_count integer NOT NULL DEFAULT 0,
  duplicate_count integer NOT NULL DEFAULT 0,
  error text CHECK (error IS NULL OR length(error) <= 1000),
  finished_at timestamptz,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invoice_import_batches_org_id_id_uq UNIQUE (org_id, id),
  CONSTRAINT invoice_import_batches_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX invoice_import_batches_org_id_idx ON public.invoice_import_batches(org_id);
--> statement-breakpoint
CREATE INDEX invoice_import_batches_org_created_idx ON public.invoice_import_batches(org_id, created_at DESC);
--> statement-breakpoint
CREATE TABLE public.invoice_import_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  batch_id uuid NOT NULL,
  file_name text NOT NULL CHECK (length(file_name) <= 300),
  mime_type text NOT NULL CHECK (length(mime_type) <= 120),
  kind text NOT NULL CHECK (kind IN ('csv','xlsx','pdf','image','zip','unsupported')),
  byte_size integer NOT NULL CHECK (byte_size >= 0),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  storage_key text,
  status text NOT NULL DEFAULT 'staged' CHECK (status IN ('staged','extracting','needs_mapping','extracted','rejected','duplicate_file','failed')),
  reject_reason text CHECK (reject_reason IS NULL OR length(reject_reason) <= 500),
  parser_version text NOT NULL DEFAULT 'v1',
  sheet jsonb,
  mapping jsonb,
  attempts integer NOT NULL DEFAULT 0,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invoice_import_files_org_id_id_uq UNIQUE (org_id, id),
  CONSTRAINT invoice_import_files_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT,
  CONSTRAINT invoice_import_files_batch_fk FOREIGN KEY (org_id, batch_id) REFERENCES public.invoice_import_batches(org_id, id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX invoice_import_files_org_id_idx ON public.invoice_import_files(org_id);
--> statement-breakpoint
CREATE INDEX invoice_import_files_batch_idx ON public.invoice_import_files(org_id, batch_id);
--> statement-breakpoint
CREATE INDEX invoice_import_files_sha_idx ON public.invoice_import_files(org_id, sha256);
--> statement-breakpoint
CREATE TABLE public.imported_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  batch_id uuid NOT NULL,
  file_id uuid NOT NULL,
  row_index integer NOT NULL DEFAULT 0,
  direction text NOT NULL DEFAULT 'unknown' CHECK (direction IN ('receivable','payable','unknown')),
  doc_type text NOT NULL DEFAULT 'invoice' CHECK (doc_type IN ('invoice','credit_note','debit_note','receipt','statement','other')),
  invoice_number text CHECK (invoice_number IS NULL OR length(invoice_number) <= 120),
  party_name text CHECK (party_name IS NULL OR length(party_name) <= 300),
  party_key text CHECK (party_key IS NULL OR length(party_key) <= 300),
  issue_date date,
  due_date date,
  currency text NOT NULL DEFAULT 'USD' CHECK (currency ~ '^[A-Z]{3}$'),
  subtotal_minor bigint,
  tax_minor bigint,
  discount_minor bigint,
  shipping_minor bigint,
  total_minor bigint,
  calculated_total_minor bigint,
  amount_paid_minor bigint NOT NULL DEFAULT 0,
  source_status text CHECK (source_status IS NULL OR length(source_status) <= 60),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','partially_paid','paid','overdue','void','disputed','written_off')),
  category text CHECK (category IS NULL OR length(category) <= 80),
  job_id uuid,
  project_label text CHECK (project_label IS NULL OR length(project_label) <= 200),
  location text CHECK (location IS NULL OR length(location) <= 200),
  cost_code text CHECK (cost_code IS NULL OR length(cost_code) <= 60),
  review_status text NOT NULL DEFAULT 'needs_review' CHECK (review_status IN ('needs_review','approved','rejected','duplicate')),
  review_reasons text[] NOT NULL DEFAULT '{}',
  fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  lines jsonb NOT NULL DEFAULT '[]'::jsonb,
  source_meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key text CHECK (dedupe_key IS NULL OR length(dedupe_key) <= 500),
  duplicate_of_id uuid,
  duplicate_override_reason text CHECK (duplicate_override_reason IS NULL OR length(duplicate_override_reason) <= 500),
  reviewed_by_user_id uuid,
  reviewed_at timestamptz,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT imported_invoices_org_id_id_uq UNIQUE (org_id, id),
  CONSTRAINT imported_invoices_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT,
  CONSTRAINT imported_invoices_batch_fk FOREIGN KEY (org_id, batch_id) REFERENCES public.invoice_import_batches(org_id, id) ON DELETE CASCADE,
  CONSTRAINT imported_invoices_file_fk FOREIGN KEY (org_id, file_id) REFERENCES public.invoice_import_files(org_id, id) ON DELETE CASCADE,
  -- A source row is turned into a record once: retried processing cannot duplicate it.
  CONSTRAINT imported_invoices_source_row_uq UNIQUE (org_id, file_id, row_index)
);
--> statement-breakpoint
CREATE INDEX imported_invoices_org_id_idx ON public.imported_invoices(org_id);
--> statement-breakpoint
CREATE INDEX imported_invoices_org_review_idx ON public.imported_invoices(org_id, review_status, created_at DESC);
--> statement-breakpoint
CREATE INDEX imported_invoices_org_dir_idx ON public.imported_invoices(org_id, direction, issue_date);
--> statement-breakpoint
CREATE INDEX imported_invoices_org_dedupe_idx ON public.imported_invoices(org_id, dedupe_key);
--> statement-breakpoint
CREATE INDEX imported_invoices_batch_idx ON public.imported_invoices(org_id, batch_id);
--> statement-breakpoint
-- Only one approved record per direction + party + invoice number in a company.
CREATE UNIQUE INDEX imported_invoices_approved_dedupe_uq ON public.imported_invoices(org_id, dedupe_key) WHERE review_status = 'approved' AND dedupe_key IS NOT NULL;
--> statement-breakpoint
CREATE TABLE public.imported_invoice_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  imported_invoice_id uuid NOT NULL,
  paid_on date NOT NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  method text CHECK (method IS NULL OR length(method) <= 60),
  reference text CHECK (reference IS NULL OR length(reference) <= 120),
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','import')),
  note text CHECK (note IS NULL OR length(note) <= 500),
  created_by_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT imported_invoice_payments_org_id_id_uq UNIQUE (org_id, id),
  CONSTRAINT imported_invoice_payments_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT,
  CONSTRAINT imported_invoice_payments_invoice_fk FOREIGN KEY (org_id, imported_invoice_id) REFERENCES public.imported_invoices(org_id, id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX imported_invoice_payments_org_id_idx ON public.imported_invoice_payments(org_id);
--> statement-breakpoint
CREATE INDEX imported_invoice_payments_invoice_idx ON public.imported_invoice_payments(org_id, imported_invoice_id);
--> statement-breakpoint
CREATE TABLE public.invoice_import_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  source_platform text NOT NULL DEFAULT 'other' CHECK (length(source_platform) <= 60),
  header_signature text NOT NULL CHECK (length(header_signature) <= 2000),
  mapping jsonb NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by_user_id uuid,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invoice_import_profiles_org_id_id_uq UNIQUE (org_id, id),
  CONSTRAINT invoice_import_profiles_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX invoice_import_profiles_org_id_idx ON public.invoice_import_profiles(org_id);
--> statement-breakpoint
CREATE INDEX invoice_import_profiles_sig_idx ON public.invoice_import_profiles(org_id, header_signature);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('public.invoice_import_batches');
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('public.invoice_import_files');
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('public.imported_invoices');
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('public.imported_invoice_payments');
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('public.invoice_import_profiles');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoice_import_batches, public.invoice_import_files, public.imported_invoices, public.imported_invoice_payments, public.invoice_import_profiles TO fieldline_app, fieldline_platform;
