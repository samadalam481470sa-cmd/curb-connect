import { createHmac, timingSafeEqual } from 'node:crypto';

export const JOBSITE_EXPORT_LINK_SECONDS = 120;

export function signJobsiteExportLink(
  secret: string,
  scope: { orgId: string; projectId: string; exportId: string; userId: string },
  expires: number,
) {
  const payload = [scope.orgId, scope.projectId, scope.exportId, scope.userId, expires].join(':');
  return createHmac('sha256', secret)
    .update('jobsite-media-export:' + payload)
    .digest('base64url');
}

export function validJobsiteExportLink(
  secret: string,
  scope: Parameters<typeof signJobsiteExportLink>[1],
  expires: number,
  token: string,
) {
  const now = Math.floor(Date.now() / 1000);
  if (expires <= now || expires > now + JOBSITE_EXPORT_LINK_SECONDS) return false;
  const signature = Buffer.from(signJobsiteExportLink(secret, scope, expires));
  const provided = Buffer.from(token);
  return signature.length === provided.length && timingSafeEqual(signature, provided);
}
