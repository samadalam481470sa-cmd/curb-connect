// Manual customers and contacts (SupplyPro GM core): request validation and row -> DTO
// mapping. The `customers`/`contacts` tables already exist in src/db/schema/crm.ts; the
// crm module was a stub with no routes, so a customer could only appear via invoice
// auto-creation. These schemas are the contract for the new manual-create API. No
// database or network here — route handlers are thin wrappers over tenantTx.
import { z } from 'zod';
import type { contacts, customers } from '../../db/schema';

export const CustomerKindSchema = z.enum(['person', 'business']);

export const CreateCustomerSchema = z.object({
  kind: CustomerKindSchema.default('person'),
  displayName: z.string().trim().min(1).max(200),
  companyName: z.string().trim().max(200).nullable().optional(),
  billingAddress: z
    .object({
      street: z.string().trim().max(300).optional(),
      city: z.string().trim().max(100).optional(),
      region: z.string().trim().max(100).optional(),
      postalCode: z.string().trim().max(20).optional(),
      country: z.string().trim().max(100).optional(),
    })
    .nullable()
    .optional(),
  tags: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
  externalRef: z.string().trim().max(200).nullable().optional(),
});

export const UpdateCustomerSchema = z
  .object({
    displayName: z.string().trim().min(1).max(200).optional(),
    companyName: z.string().trim().max(200).nullable().optional(),
    status: z.enum(['active', 'archived']).optional(),
    billingAddress: CreateCustomerSchema.shape.billingAddress,
    tags: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
    externalRef: z.string().trim().max(200).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update.' });

export const CreateContactSchema = z.object({
  firstName: z.string().trim().max(100).nullable().optional(),
  lastName: z.string().trim().max(100).nullable().optional(),
  displayName: z.string().trim().min(1).max(200),
  email: z.email().max(254).nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  role: z.string().trim().max(100).nullable().optional(),
  isPrimary: z.boolean().default(false),
  preferredChannel: z.enum(['email', 'phone', 'sms']).nullable().optional(),
});

export const UpdateContactSchema = z
  .object({
    firstName: z.string().trim().max(100).nullable().optional(),
    lastName: z.string().trim().max(100).nullable().optional(),
    displayName: z.string().trim().min(1).max(200).optional(),
    email: z.email().max(254).nullable().optional(),
    phone: z.string().trim().max(40).nullable().optional(),
    role: z.string().trim().max(100).nullable().optional(),
    isPrimary: z.boolean().optional(),
    preferredChannel: z.enum(['email', 'phone', 'sms']).nullable().optional(),
    status: z.enum(['active', 'archived']).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update.' });

export type CreateCustomerInput = z.infer<typeof CreateCustomerSchema>;
export type CreateContactInput = z.infer<typeof CreateContactSchema>;

export const CustomerSchema = z.object({
  id: z.uuid(),
  kind: CustomerKindSchema,
  displayName: z.string(),
  companyName: z.string().nullable(),
  status: z.string(),
  billingAddress: z.unknown().nullable(),
  tags: z.array(z.string()),
  externalRef: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const ContactSchema = z.object({
  id: z.uuid(),
  customerId: z.uuid().nullable(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  displayName: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  role: z.string().nullable(),
  isPrimary: z.boolean(),
  preferredChannel: z.string().nullable(),
  status: z.string(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export type CustomerDto = z.infer<typeof CustomerSchema>;
export type ContactDto = z.infer<typeof ContactSchema>;

type CustomerRow = typeof customers.$inferSelect;
type ContactRow = typeof contacts.$inferSelect;

export function customerDto(row: CustomerRow): CustomerDto {
  return CustomerSchema.parse({
    id: row.id,
    kind: row.kind,
    displayName: row.displayName,
    companyName: row.companyName,
    status: row.status,
    billingAddress: row.billingAddress,
    tags: row.tags,
    externalRef: row.externalRef,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

export function contactDto(row: ContactRow): ContactDto {
  return ContactSchema.parse({
    id: row.id,
    customerId: row.customerId,
    firstName: row.firstName,
    lastName: row.lastName,
    displayName: row.displayName,
    email: row.email,
    phone: row.phone,
    role: row.role,
    isPrimary: row.isPrimary,
    preferredChannel: row.preferredChannel,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

/** Plain-language label for a customer in pickers and job cards. */
export function customerLabel(row: {
  displayName: string;
  companyName: string | null;
  kind: string;
}): string {
  if (row.kind === 'business' && row.companyName && row.companyName !== row.displayName) {
    return `${row.companyName} (${row.displayName})`;
  }
  return row.displayName;
}
