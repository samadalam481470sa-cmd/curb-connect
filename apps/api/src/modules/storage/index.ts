// `storage` module: the LocalEncryptedStorage URL endpoints. A signed token alone is not enough:
// every upload and download also needs a session whose active, valid membership is in the org
// that the object key belongs to (BE-078 A, BE-075 S). With S3 these routes are unused; the
// presigned URLs are issued by media routes only after the same authorization.
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { uploadSessions } from '../../db/schema';
import { requireOrg, tenantTx } from '../../http/context';
import { problem } from '../../http/problem';
import { orgIdFromKey, safeFileName, storageSigningSecret } from '../../storage';
import { verifyStorageToken } from '../../storage/signing';

const TokenParams = z.object({ token: z.string().min(10).max(4096) });

const storageModule: FastifyPluginAsyncZod = async (app) => {
  const secret = storageSigningSecret(app.config);
  const limit = app.config.storage.maxUploadBytes;

  // Raw bodies for uploads only (this plugin's encapsulation context).
  app.addContentTypeParser('*', { parseAs: 'buffer', bodyLimit: limit }, (_request, body, done) => done(null, body));

  app.put(
    '/storage/upload/:token',
    {
      config: { auth: 'org', rateLimit: { max: 240, timeWindow: '1 minute' } },
      bodyLimit: limit,
      schema: {
        tags: ['storage'],
        summary: 'Signed upload target for the local encrypted adapter (send the raw file body)',
        params: TokenParams,
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      if (app.storage.driver !== 'local') throw problem('not_found');
      const org = requireOrg(request);
      const check = verifyStorageToken(secret, request.params.token, 'upload');
      if (!check.ok) {
        throw check.reason === 'expired' ? problem('upload_expired') : problem('not_found');
      }
      const { claims } = check;
      // Another company's key (or a forged one) looks exactly like a missing object.
      if (orgIdFromKey(claims.key) !== org.orgId) throw problem('not_found');
      const contentType = String(request.headers['content-type'] ?? '').split(';')[0]!.trim();
      if (contentType !== claims.contentType) {
        throw problem('unsupported_media_type', `Send Content-Type: ${claims.contentType}.`);
      }
      const body = request.body;
      if (!Buffer.isBuffer(body)) throw problem('bad_request', 'Send the file as the raw request body.');
      if (body.length > (claims.maxBytes ?? limit)) {
        throw problem('payload_too_large', 'The file is larger than the size declared for this upload.');
      }
      const [session] = await tenantTx(request, (tx) =>
        tx
          .select({ status: uploadSessions.status, expiresAt: uploadSessions.expiresAt })
          .from(uploadSessions)
          .where(and(eq(uploadSessions.orgId, org.orgId), eq(uploadSessions.objectKey, claims.key))),
      );
      if (!session) throw problem('not_found');
      if (session.status !== 'pending') throw problem('invalid_transition', 'This upload is already finished.');
      if (session.expiresAt <= new Date()) throw problem('upload_expired');
      await app.storage.put(claims.key, body, claims.contentType);
      return reply.status(204).send(null);
    },
  );

  app.get(
    '/storage/object/:token',
    {
      config: { auth: 'org' },
      schema: {
        tags: ['storage'],
        summary: 'Signed, short-lived download for the local adapter (also requires a session in the owning company)',
        params: TokenParams,
      },
    },
    async (request, reply) => {
      if (app.storage.driver !== 'local') throw problem('not_found');
      const org = requireOrg(request);
      const check = verifyStorageToken(secret, request.params.token, 'download');
      if (!check.ok || orgIdFromKey(check.claims.key) !== org.orgId) throw problem('not_found');
      const bytes = await app.storage.get(check.claims.key).catch(() => null);
      if (!bytes) throw problem('not_found');
      reply
        .type(check.claims.contentType)
        .header('cache-control', 'private, no-store')
        .header('x-content-type-options', 'nosniff')
        .header('content-disposition', `inline; filename="${safeFileName(check.claims.fileName)}"`);
      return reply.send(bytes);
    },
  );
};

export default storageModule;
