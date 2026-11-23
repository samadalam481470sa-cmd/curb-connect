-- Chunked, resumable invoice-import uploads (additive): one row per in-progress large-file
-- upload into an import batch. Parts themselves live in object storage; this row tracks which
-- parts arrived so an interrupted upload can resume. Existing tables are not changed.
CREATE TABLE public.invoice_import_uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  batch_id uuid NOT NULL,
  file_name text NOT NULL CHECK (length(file_name) <= 300),
  total_bytes integer NOT NULL CHECK (total_bytes > 0),
  chunk_bytes integer NOT NULL CHECK (chunk_bytes > 0),
  chunk_count integer NOT NULL CHECK (chunk_count > 0),
  received jsonb NOT NULL DEFAULT '[]'::jsonb,
  expected_sha256 text CHECK (expected_sha256 IS NULL OR expected_sha256 ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'receiving' CHECK (status IN ('receiving','completed','abandoned','expired','failed')),
  file_id uuid,
  created_by_user_id uuid,
  expires_at timestamptz NOT NULL,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invoice_import_uploads_org_id_id_uq UNIQUE (org_id, id),
  CONSTRAINT invoice_import_uploads_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT,
  CONSTRAINT invoice_import_uploads_batch_fk FOREIGN KEY (org_id, batch_id) REFERENCES public.invoice_import_batches(org_id, id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX invoice_import_uploads_org_id_idx ON public.invoice_import_uploads(org_id);
--> statement-breakpoint
CREATE INDEX invoice_import_uploads_batch_idx ON public.invoice_import_uploads(org_id, batch_id);
--> statement-breakpoint
CREATE INDEX invoice_import_uploads_expiry_idx ON public.invoice_import_uploads(org_id, status, expires_at);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('public.invoice_import_uploads');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoice_import_uploads TO fieldline_app, fieldline_platform;
