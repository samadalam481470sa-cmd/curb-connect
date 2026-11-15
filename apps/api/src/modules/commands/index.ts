// `commands` module (COS starter C/D, ADD-014, ADD-016, ADD-078): POST /v1/commands executes one
// typed command and returns its receipt; GET /v1/commands/{id} looks the receipt up after a client
// timeout (a missing receipt means "not committed": the client may resend the SAME command_id).
// Reads never write audit rows or outbox events.
import { CommandEnvelopeSchema, CommandReceiptSchema, ProblemSchema, UuidSchema } from '@fieldline/contracts';
import { and, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { commandReceipts } from '../../db/schema';
import { requireOrg, tenantTx } from '../../http/context';
import { problem } from '../../http/problem';
import { executeCommand, readCommandKey } from './pipeline';
import { registeredCommandTypes } from './registry';

const commandsModule: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/commands',
    {
      config: { auth: 'org' },
      schema: {
        tags: ['commands'],
        summary: 'Execute a command (Idempotency-Key = command_id)',
        description:
          'Server steps: authenticate, internal user, tenant + resource membership, validate, receipt lookup, revision check, one transaction (aggregate + audit + outbox), receipt. 409 revision_conflict carries a non-sensitive field diff.',
        body: CommandEnvelopeSchema,
        response: { 200: CommandReceiptSchema, 201: CommandReceiptSchema, 409: ProblemSchema },
      },
    },
    async (request, reply) => {
      requireOrg(request);
      const key = readCommandKey(request);
      if (!key) throw problem('idempotency_key_required', 'Send Idempotency-Key equal to command_id.');
      if (key !== request.body.command_id.toLowerCase()) {
        throw problem('validation_failed', 'Idempotency-Key must equal command_id.', {
          errors: [{ path: 'headers.idempotency-key', message: 'must equal body.command_id' }],
        });
      }
      const result = await executeCommand(request, request.body);
      if (result.replayed) reply.header('idempotent-replayed', 'true');
      reply.status(result.replayed ? 200 : 201);
      return result.receipt;
    },
  );

  app.get(
    '/commands/:id',
    {
      config: { auth: 'org' },
      schema: {
        tags: ['commands'],
        summary: 'Receipt lookup for timeout recovery (404 = not committed)',
        params: z.object({ id: UuidSchema }),
        response: { 200: CommandReceiptSchema },
      },
    },
    async (request) => {
      const org = requireOrg(request);
      const row = await tenantTx(request, async (tx) => {
        const [found] = await tx
          .select({ body: commandReceipts.responseBody })
          .from(commandReceipts)
          .where(and(eq(commandReceipts.orgId, org.orgId), eq(commandReceipts.commandId, request.params.id)));
        return found;
      });
      if (!row) throw problem('not_found', 'No committed command with this id. It is safe to resend it with the same command_id.');
      return CommandReceiptSchema.parse(row.body);
    },
  );

  app.get(
    '/commands/types',
    {
      config: { auth: 'org' },
      schema: {
        tags: ['commands'],
        summary: 'Registered command types',
        response: { 200: z.object({ types: z.array(z.string()) }) },
      },
    },
    async () => ({ types: registeredCommandTypes() }),
  );
};

export default commandsModule;
