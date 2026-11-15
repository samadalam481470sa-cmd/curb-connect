// `search` module. This file currently implements only the ADDRESS part (RF-017, ADD-021):
// autocomplete through the configured geocoder adapter (fixture / Esri World Geocoding / Google
// behind a key) with honest provenance on every candidate. Address search is read-only: it writes
// no audit rows or outbox events. Tenant-scoped global record search is not built yet.
import { AddressSearchQuerySchema, AddressSearchResponseSchema } from '@fieldline/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { geocoder } from '../properties/geocoder';

const searchModule: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/search/addresses',
    {
      config: { permission: 'property:read' },
      schema: {
        tags: ['search'],
        summary: 'Address autocomplete (provider attribution and storage rights on each candidate)',
        querystring: AddressSearchQuerySchema,
        response: { 200: AddressSearchResponseSchema },
      },
    },
    async (request) => ({ candidates: await geocoder().search(request.query.q) }),
  );
};

export default searchModule;
