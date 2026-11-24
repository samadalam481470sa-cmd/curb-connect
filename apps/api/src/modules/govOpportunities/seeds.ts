// Seed .gov resource pages the Gov Opportunities scanner checks for dead outbound links.
//
// Every URL below was verified to load on 2026-11-24 before it was added here. Two candidates
// were dropped for failing that check: Austin's small-business resources page (404) and the
// SBA Texas local-assistance page (404). If a seed page stops loading, the scanner reports it
// as unknown for that run — it is never silently replaced with a guessed URL.
//
// The pages are the city/state "helpful links" resource pages from the @many.talks.biz reel:
// a contractor whose trade matches a dead link on one of these pages can offer their own
// service page as the replacement.
import type { GovSeedPage } from '@fieldline/contracts';

export const SEED_PAGES: GovSeedPage[] = [
  {
    id: 'tx-cmbl',
    name: 'Texas Comptroller — Centralized Master Bidders List (CMBL)',
    city: 'State of Texas',
    url: 'https://comptroller.texas.gov/purchasing/vendor/cmbl/',
    verifiedAt: '2026-11-24',
  },
  {
    id: 'fort-worth-econdev',
    name: 'City of Fort Worth — Economic Development',
    city: 'Fort Worth',
    url: 'https://www.fortworthtexas.gov/departments/econdev',
    verifiedAt: '2026-11-24',
  },
  {
    id: 'dallas-enterprise-hub',
    name: 'City of Dallas — Business Enterprise Hub',
    city: 'Dallas',
    url: 'https://dallascityhall.com/departments/procurement/Pages/Business-Enterprise-Hub.aspx',
    verifiedAt: '2026-11-24',
  },
  {
    id: 'san-antonio-edd',
    name: 'City of San Antonio — Economic Development (small business)',
    city: 'San Antonio',
    url: 'https://www.sanantonio.gov/edd/small-business',
    verifiedAt: '2026-11-24',
  },
  {
    id: 'arlington-econdev',
    name: 'City of Arlington — Office of Economic Development',
    city: 'Arlington',
    url: 'https://www.arlingtontx.gov/city_hall/departments/economic_development',
    verifiedAt: '2026-11-24',
  },
];

/** Trade -> words that tie a dead link (its text or URL) to that trade. A match on any word
 *  makes the opportunity 'strong'; a dead link with no trade word is still shown as
 *  'general' for the contractor's city. Kept in sync with the TRADES list in permitLeads. */
export const TRADE_KEYWORDS: Record<string, string[]> = {
  grading: ['grading', 'excavat', 'site work', 'sitework', 'earthwork', 'land clearing'],
  concrete: ['concrete', 'curb', 'foundation', 'flatwork', 'paving'],
  roofing: ['roof', 'roofing', 'shingle'],
  materials: ['material', 'lumber', 'supply', 'supplier', 'building products'],
  framing: ['fram', 'carpentr', 'lumber'],
  hvac: ['hvac', 'heating', 'cooling', 'air conditioning', 'ventilation'],
  electrical: ['electric', 'electrician', 'wiring'],
  plumbing: ['plumb', 'pipe', 'sewer', 'water'],
  general: ['contractor', 'construction', 'builder', 'remodel', 'subcontractor'],
};

export function tradeKeywords(trade: string): string[] {
  return TRADE_KEYWORDS[trade] ?? TRADE_KEYWORDS.general ?? [];
}
