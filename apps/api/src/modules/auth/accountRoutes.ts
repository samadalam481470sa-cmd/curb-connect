// Delete your own account (POST /v1/auth/account/delete). The caller must type DELETE in the
// Settings dialog; the server requires the same word in the body, so an accidental request
// cannot delete anything. Runs as the platform operation 'auth.account_delete' (see
// src/db/runtime.ts); the work itself lives in accountDeletion.ts.
import {
  DeleteAccountRequestSchema,
  DeleteAccountResponseSchema,
} from '@fieldline/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { platformTx, requireUser } from '../../http/context';
import { clearSessionCookie } from '../../services/sessions';
import { deleteAccountForUser } from './accountDeletion';

const accountRoutes: FastifyPluginAsyncZod = async (app) => {
  // Deleting an account is rare and irreversible: a third of the sign-in rate limit is plenty.
  const strictLimit = {
    max: Math.max(1, Math.floor(app.config.auth.rateLimitPerMinute / 3)),
    timeWindow: '1 minute',
  };

  app.post(
    '/auth/account/delete',
    {
      config: { auth: 'user', rateLimit: strictLimit },
      schema: {
        tags: ['auth'],
        summary:
          'Delete your own account: closes workspaces you solely own, removes you from shared ones, deletes your sign-in and sessions',
        body: DeleteAccountRequestSchema,
        response: { 200: DeleteAccountResponseSchema },
      },
    },
    async (request, reply) => {
      const auth = requireUser(request);
      const result = await platformTx(
        request,
        'auth.account_delete',
        (tx) => deleteAccountForUser(tx, auth.userId),
        { orgId: null, userId: auth.userId },
      );
      // The session row is gone; the cookie must go with it.
      clearSessionCookie(reply, app.config);
      request.log.info(
        {
          userId: auth.userId,
          organizationsClosed: result.organizationsClosed.map((o) => o.id),
          retainedTables: result.retainedTables,
        },
        'account deleted',
      );
      return result;
    },
  );
};

export default accountRoutes;
