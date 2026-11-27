-- 0107: labor rate book (Plan-to-Bid, audit-gaps round 2).
--   * labor_rates: contractor-entered hourly rates per Plan-to-Bid trade,
--     stored per organization and reusable across bids. A rate reaches a bid
--     only when the contractor picks it — there are no default rates and
--     nothing is auto-applied. Money is integer minor units (cents/hour).
CREATE TABLE public.labor_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  trade text NOT NULL CHECK (trade IN ('sitework','excavation','foundations','underground_plumbing','rebar_vapor','structural_steel','framing','roofing','envelope','electrical','plumbing','hvac','interior_finishes','exterior_finishes')),
  label text NOT NULL CHECK (length(label) BETWEEN 1 AND 80),
  rate_cents_per_hour integer NOT NULL CHECK (rate_cents_per_hour BETWEEN 1 AND 1000000),
  note text NOT NULL DEFAULT '' CHECK (length(note) <= 300),
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT labor_rates_org_id_id_uq UNIQUE (org_id, id),
  CONSTRAINT labor_rates_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT,
  CONSTRAINT labor_rates_org_id_trade_label_uq UNIQUE (org_id, trade, label)
);
--> statement-breakpoint
CREATE INDEX labor_rates_org_id_idx ON public.labor_rates(org_id);
--> statement-breakpoint
CREATE INDEX labor_rates_org_id_trade_idx ON public.labor_rates(org_id, trade);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('public.labor_rates');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.labor_rates TO fieldline_app, fieldline_platform;
