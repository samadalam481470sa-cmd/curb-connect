-- Opt-in contractor bid board. Every offer is owned by the posting company; cross-company
-- reads and submissions require a named, audited platform operation with explicit ACL checks.
CREATE TABLE public.bid_opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  author_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  title text NOT NULL CHECK (char_length(title) BETWEEN 4 AND 180),
  description text NOT NULL CHECK (char_length(description) BETWEEN 10 AND 8000),
  trade text NOT NULL CHECK (trade IN ('roof','curb','plumbing','hvac','electrical','concrete','general','other')),
  city text NOT NULL CHECK (char_length(city) BETWEEN 2 AND 100),
  region text NOT NULL CHECK (char_length(region) BETWEEN 2 AND 100),
  currency char(3) NOT NULL DEFAULT 'USD',
  budget_minor bigint CHECK (budget_minor IS NULL OR budget_minor >= 0),
  due_on date,
  visibility text NOT NULL DEFAULT 'connections' CHECK (visibility IN ('connections','marketplace')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','awarded')),
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bid_opportunities_org_id_id_uq UNIQUE (org_id,id)
);
--> statement-breakpoint
CREATE INDEX bid_opportunities_org_id_idx ON public.bid_opportunities(org_id);
--> statement-breakpoint
CREATE INDEX bid_opportunities_trade_city_idx ON public.bid_opportunities(trade,city,status);
--> statement-breakpoint
CREATE TABLE public.bid_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  opportunity_id uuid NOT NULL,
  bidder_org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  bidder_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  bidder_name text NOT NULL CHECK (char_length(bidder_name) BETWEEN 1 AND 180),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  estimated_days integer CHECK (estimated_days IS NULL OR estimated_days BETWEEN 1 AND 3650),
  message text NOT NULL CHECK (char_length(message) BETWEEN 10 AND 4000),
  status text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','accepted','declined')),
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bid_offers_opportunity_fk FOREIGN KEY (org_id,opportunity_id)
    REFERENCES public.bid_opportunities(org_id,id) ON DELETE RESTRICT,
  CONSTRAINT bid_offers_one_company_per_post_uq UNIQUE (opportunity_id,bidder_org_id)
);
--> statement-breakpoint
CREATE INDEX bid_offers_org_id_idx ON public.bid_offers(org_id);
--> statement-breakpoint
CREATE INDEX bid_offers_bidder_org_id_idx ON public.bid_offers(bidder_org_id);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('public.bid_opportunities');
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('public.bid_offers');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bid_opportunities, public.bid_offers TO fieldline_app, fieldline_platform;
