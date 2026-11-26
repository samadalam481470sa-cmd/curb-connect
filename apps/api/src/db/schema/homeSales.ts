// Tables owned by the `homeSales` module: the home-sales pipeline (prospects with buyer AND
// agent dual tracking, appointments), sales contracts with priced selections, and the builder's
// own options catalog for the design center. Every price is builder-entered; selections
// snapshot the catalog price at selection time. Contracts can link a House Studio house so
// selections are visualized against the 3D model.
import { boolean, text, uuid } from 'drizzle-orm/pg-core';
import { currencyColumn, minorUnits, revisionColumn, tsColumn } from './_columns';
import { tenantTable } from './_tenant';
import { customers } from './crm';
import { studioHouses } from './homeBuilder';
import { jobs } from './jobs';

export const salesProspects = tenantTable(
  'sales_prospects',
  {
    buyerName: text('buyer_name').notNull(),
    buyerEmail: text('buyer_email'),
    buyerPhone: text('buyer_phone'),
    agentName: text('agent_name'),
    agentEmail: text('agent_email'),
    agentPhone: text('agent_phone'),
    agentBrokerage: text('agent_brokerage'),
    stage: text('stage')
      .$type<'new' | 'contacted' | 'appointment' | 'contract' | 'closed' | 'lost'>()
      .notNull()
      .default('new'),
    communityName: text('community_name'),
    budgetMinor: minorUnits('budget_minor'),
    currency: currencyColumn(),
    notes: text('notes'),
    customerId: uuid('customer_id'),
    revision: revisionColumn(),
  },
  (_t, h) => [h.fk('customerId', () => customers), h.idx('orgId', 'stage')],
);

export const salesAppointments = tenantTable(
  'sales_appointments',
  {
    prospectId: uuid('prospect_id').notNull(),
    startsAt: tsColumn('starts_at').notNull(),
    endsAt: tsColumn('ends_at').notNull(),
    location: text('location'),
    note: text('note'),
    status: text('status')
      .$type<'booked' | 'completed' | 'cancelled' | 'no_show'>()
      .notNull()
      .default('booked'),
  },
  (_t, h) => [h.fk('prospectId', () => salesProspects, 'cascade'), h.idx('prospectId', 'startsAt')],
);

export const salesOptions = tenantTable(
  'sales_options',
  {
    category: text('category')
      .$type<'structural' | 'elevation' | 'finish' | 'fixture' | 'flooring' | 'other'>()
      .notNull(),
    name: text('name').notNull(),
    description: text('description'),
    priceMinor: minorUnits('price_minor'),
    currency: currencyColumn(),
    visualNote: text('visual_note'),
    active: boolean('active').notNull().default(true),
  },
  (_t, h) => [h.idx('orgId', 'category')],
);

export const salesContracts = tenantTable(
  'sales_contracts',
  {
    prospectId: uuid('prospect_id').notNull(),
    status: text('status')
      .$type<'draft' | 'signed' | 'in_design' | 'under_construction' | 'closed' | 'cancelled'>()
      .notNull()
      .default('draft'),
    communityName: text('community_name'),
    lotLabel: text('lot_label'),
    planName: text('plan_name'),
    basePriceMinor: minorUnits('base_price_minor'),
    currency: currencyColumn(),
    studioHouseId: uuid('studio_house_id'),
    jobId: uuid('job_id'),
    signedOn: text('signed_on'),
    revision: revisionColumn(),
  },
  (_t, h) => [
    h.fk('prospectId', () => salesProspects),
    h.fk('studioHouseId', () => studioHouses),
    h.fk('jobId', () => jobs),
    h.idx('orgId', 'status'),
  ],
);

export const salesSelections = tenantTable(
  'sales_selections',
  {
    contractId: uuid('contract_id').notNull(),
    optionId: uuid('option_id').notNull(),
    priceMinor: minorUnits('price_minor'),
    currency: currencyColumn(),
    note: text('note'),
  },
  (_t, h) => [
    h.fk('contractId', () => salesContracts, 'cascade'),
    h.fk('optionId', () => salesOptions),
    h.uniq('orgId', 'contractId', 'optionId'),
  ],
);
