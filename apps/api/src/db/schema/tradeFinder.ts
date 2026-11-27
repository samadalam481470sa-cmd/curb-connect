// Tables owned by the `tradeFinder` module (blueprint gap 6):
//   * directory_profiles — one per org; the published trade-directory fields
//     (trades, service cities/ZIPs, availability, license/insurance expiry).
//     Read cross-tenant ONLY for organizations that opted in to the directory
//     (organizations.directory_opt_in), via the named platform operation
//     'trade_finder.search' — published data only, never private records.
//   * vendor_profiles — the org's own private vendor records with the same
//     qualification fields. Tenant-scoped; never exposed to other tenants.
import { sql } from 'drizzle-orm';
import { date, text } from 'drizzle-orm/pg-core';
import { revisionColumn } from './_columns';
import { tenantTable } from './_tenant';

const textArray = (name: string) =>
  text(name)
    .array()
    .notNull()
    .default(sql`'{}'`);

export const directoryProfiles = tenantTable(
  'directory_profiles',
  {
    trades: textArray('trades'),
    serviceCities: textArray('service_cities'),
    serviceZips: textArray('service_zips'),
    availability: text('availability').$type<'available' | 'busy' | 'not_taking_work'>(),
    availabilityNote: text('availability_note'),
    licenseNumber: text('license_number'),
    licenseExpiresOn: date('license_expires_on'),
    insuranceExpiresOn: date('insurance_expires_on'),
    qualificationsNote: text('qualifications_note'),
    revision: revisionColumn(),
  },
  (t, h) => [h.uniq('orgId')],
);

export const vendorProfiles = tenantTable(
  'vendor_profiles',
  {
    name: text('name').notNull(),
    trade: text('trade'),
    contactName: text('contact_name'),
    contactPhone: text('contact_phone'),
    contactEmail: text('contact_email'),
    serviceCities: textArray('service_cities'),
    serviceZips: textArray('service_zips'),
    availability: text('availability').$type<'available' | 'busy' | 'not_taking_work'>(),
    availabilityNote: text('availability_note'),
    licenseNumber: text('license_number'),
    licenseExpiresOn: date('license_expires_on'),
    insuranceExpiresOn: date('insurance_expires_on'),
    qualificationsNote: text('qualifications_note'),
    notes: text('notes'),
    revision: revisionColumn(),
  },
  (t, h) => [h.idx('orgId', 'trade')],
);
