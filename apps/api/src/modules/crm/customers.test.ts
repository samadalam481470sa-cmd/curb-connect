// Manual customers and contacts: pure-logic tests. No database, no network — the route
// handlers are thin wrappers over tenantTx/auditRequest, so what is tested here is the
// contract: request validation and the row -> DTO mapping, including the primary-contact
// flag and the customer label.
import { describe, expect, it } from 'vitest';
import {
  CreateContactSchema,
  CreateCustomerSchema,
  UpdateContactSchema,
  UpdateCustomerSchema,
  contactDto,
  customerDto,
  customerLabel,
} from './customers';

const CUSTOMER_ID = '11111111-1111-4111-8111-111111111111';
const CONTACT_ID = '22222222-2222-4222-8222-222222222222';
const NOW = new Date('2026-11-25T02:00:00.000Z');

function customerRow(overrides: Record<string, unknown> = {}) {
  return {
    id: CUSTOMER_ID,
    orgId: '33333333-3333-4333-8333-333333333333',
    kind: 'person' as const,
    displayName: 'Jane Homeowner',
    companyName: null,
    status: 'active' as const,
    mergedIntoId: null,
    billingAddress: null,
    tags: [],
    externalRef: null,
    revision: 1,
    deletedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function contactRow(overrides: Record<string, unknown> = {}) {
  return {
    id: CONTACT_ID,
    orgId: '33333333-3333-4333-8333-333333333333',
    customerId: CUSTOMER_ID,
    firstName: 'Jane',
    lastName: 'Homeowner',
    displayName: 'Jane Homeowner',
    email: 'jane@example.com',
    phone: '469-555-0100',
    role: 'Owner',
    isPrimary: true,
    preferredChannel: 'email',
    status: 'active' as const,
    revision: 1,
    deletedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe('CreateCustomerSchema', () => {
  it('accepts a minimal person customer and defaults kind to person', () => {
    const parsed = CreateCustomerSchema.parse({ displayName: 'Jane Homeowner' });
    expect(parsed.kind).toBe('person');
    expect(parsed.tags).toBeUndefined();
  });

  it('accepts a business customer with address, tags and external ref', () => {
    const parsed = CreateCustomerSchema.parse({
      kind: 'business',
      displayName: 'Acme Builders LLC',
      companyName: 'Acme Builders LLC',
      billingAddress: { street: '1 Main St', city: 'Dallas', region: 'TX', postalCode: '75201' },
      tags: ['builder', 'repeat'],
      externalRef: 'QB-1042',
    });
    expect(parsed.billingAddress?.city).toBe('Dallas');
    expect(parsed.tags).toEqual(['builder', 'repeat']);
  });

  it('rejects an empty display name and more than 30 tags', () => {
    expect(() => CreateCustomerSchema.parse({ displayName: '  ' })).toThrow();
    expect(() =>
      CreateCustomerSchema.parse({ displayName: 'X', tags: Array.from({ length: 31 }, (_, i) => `t${i}`) }),
    ).toThrow();
  });
});

describe('UpdateCustomerSchema', () => {
  it('accepts a partial update and rejects an empty one', () => {
    expect(UpdateCustomerSchema.parse({ status: 'archived' }).status).toBe('archived');
    expect(() => UpdateCustomerSchema.parse({})).toThrow('Nothing to update.');
  });
});

describe('CreateContactSchema', () => {
  it('accepts a full contact and defaults isPrimary to false', () => {
    const parsed = CreateContactSchema.parse({
      displayName: 'Jane Homeowner',
      email: 'jane@example.com',
      phone: '469-555-0100',
      role: 'Owner',
    });
    expect(parsed.isPrimary).toBe(false);
  });

  it('rejects a bad email and an empty display name', () => {
    expect(() => CreateContactSchema.parse({ displayName: 'Jane', email: 'not-an-email' })).toThrow();
    expect(() => CreateContactSchema.parse({ displayName: '' })).toThrow();
  });
});

describe('UpdateContactSchema', () => {
  it('accepts a primary flip and rejects an empty update', () => {
    expect(UpdateContactSchema.parse({ isPrimary: true }).isPrimary).toBe(true);
    expect(() => UpdateContactSchema.parse({})).toThrow('Nothing to update.');
  });
});

describe('customerDto / contactDto', () => {
  it('maps a customer row, keeping tags and nulls', () => {
    const dto = customerDto(customerRow({ tags: ['builder'] }));
    expect(dto).toMatchObject({ id: CUSTOMER_ID, displayName: 'Jane Homeowner', tags: ['builder'] });
    expect(dto.createdAt).toBe('2026-11-25T02:00:00.000Z');
  });

  it('maps a contact row, keeping the primary flag', () => {
    const dto = contactDto(contactRow());
    expect(dto).toMatchObject({ id: CONTACT_ID, customerId: CUSTOMER_ID, isPrimary: true });
  });
});

describe('customerLabel', () => {
  it('shows the company name with the contact name for businesses', () => {
    expect(
      customerLabel({ displayName: 'Sam Acme', companyName: 'Acme Builders LLC', kind: 'business' }),
    ).toBe('Acme Builders LLC (Sam Acme)');
  });

  it('shows just the display name for people and same-name businesses', () => {
    expect(customerLabel({ displayName: 'Jane Homeowner', companyName: null, kind: 'person' })).toBe(
      'Jane Homeowner',
    );
    expect(
      customerLabel({ displayName: 'Acme Builders LLC', companyName: 'Acme Builders LLC', kind: 'business' }),
    ).toBe('Acme Builders LLC');
  });
});
