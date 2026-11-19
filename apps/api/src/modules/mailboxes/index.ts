// `mailboxes` module: the signed-in member's own Gmail / Outlook connections, used to email
// invoices from their address. Every token lives in the separate mail server (apps/mailer); this
// module signs requests for the member taken from the session cookie and relays the answers.
import {
  ConfirmMailboxRequestSchema,
  ConnectMailboxRequestSchema,
  ConnectMailboxResponseSchema,
  MailboxListSchema,
  MailboxProviderSchema,
  SetDefaultMailboxRequestSchema,
} from '@fieldline/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireOrg } from '../../http/context';
import { problem } from '../../http/problem';
import { MailerError } from '../../services/mailer-client';

/** Turns a mail server refusal into the API's problem vocabulary. */
export function mailerProblem(error: unknown): never {
  if (error instanceof MailerError) {
    if (error.code === 'unavailable') throw problem('feature_unavailable', error.message);
    if (error.code === 'not_connected' || error.code === 'reconnect_required') {
      throw problem('precondition_failed', error.message);
    }
    if (error.code === 'retry') throw problem('dependency_unavailable', error.message);
    throw problem('conflict', error.message);
  }
  throw error;
}

const mailboxesModule: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/mailboxes',
    {
      config: { permission: 'mailbox:manage_own' },
      schema: {
        tags: ['mailboxes'],
        summary: 'Your connected Gmail and Outlook mailboxes',
        response: { 200: MailboxListSchema },
      },
    },
    async (request, reply) => {
      reply.header('cache-control', 'private, no-store');
      const { orgId, userId } = requireOrg(request);
      try {
        return await app.mailer.list({ orgId, userId });
      } catch (error) {
        // A mail server outage should not break the settings page: show it as unavailable.
        if (
          error instanceof MailerError &&
          (error.code === 'retry' || error.code === 'unavailable')
        ) {
          request.log.warn({ err: error.message }, 'mail server unavailable');
          return {
            available: false,
            providers: { gmail: false, outlook: false },
            defaultProvider: null,
            items: [],
          };
        }
        return mailerProblem(error);
      }
    },
  );

  app.post(
    '/mailboxes/connect',
    {
      config: { permission: 'mailbox:manage_own', rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: {
        tags: ['mailboxes'],
        summary: 'Start Google or Microsoft sign-in to connect a mailbox (returns where to go)',
        body: ConnectMailboxRequestSchema,
        response: { 200: ConnectMailboxResponseSchema },
      },
    },
    async (request) => {
      const { orgId, userId } = requireOrg(request);
      try {
        return {
          url: await app.mailer.connectUrl(
            { orgId, userId },
            request.body.provider,
            '/settings/email',
          ),
        };
      } catch (error) {
        return mailerProblem(error);
      }
    },
  );

  app.post(
    '/mailboxes/confirm',
    {
      config: { permission: 'mailbox:manage_own', rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: {
        tags: ['mailboxes'],
        summary: 'Finish connecting a mailbox after Google or Microsoft sign-in',
        body: ConfirmMailboxRequestSchema,
        response: { 200: MailboxListSchema },
      },
    },
    async (request) => {
      const { orgId, userId } = requireOrg(request);
      try {
        return await app.mailer.confirm({ orgId, userId }, request.body.pending);
      } catch (error) {
        return mailerProblem(error);
      }
    },
  );

  app.put(
    '/mailboxes/default',
    {
      config: { permission: 'mailbox:manage_own' },
      schema: {
        tags: ['mailboxes'],
        summary: 'Choose which connected mailbox invoices are sent from',
        body: SetDefaultMailboxRequestSchema,
        response: { 200: MailboxListSchema },
      },
    },
    async (request) => {
      const { orgId, userId } = requireOrg(request);
      try {
        return await app.mailer.setDefault({ orgId, userId }, request.body.provider);
      } catch (error) {
        return mailerProblem(error);
      }
    },
  );

  app.delete(
    '/mailboxes/:provider',
    {
      config: { permission: 'mailbox:manage_own' },
      schema: {
        tags: ['mailboxes'],
        summary: 'Disconnect a mailbox (Google access is revoked; the stored token is deleted)',
        params: z.object({ provider: MailboxProviderSchema }),
        response: { 200: MailboxListSchema },
      },
    },
    async (request) => {
      const { orgId, userId } = requireOrg(request);
      try {
        return await app.mailer.disconnect({ orgId, userId }, request.params.provider);
      } catch (error) {
        return mailerProblem(error);
      }
    },
  );
};

export default mailboxesModule;
