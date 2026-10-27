// Optimistic concurrency (BE-073 D): resources carry an integer `revision`; GET returns it as an
// ETag, PATCH must send it back in If-Match. Missing header -> 428, stale revision -> 412.
import type { FastifyReply, FastifyRequest } from 'fastify';
import { problem } from './problem';

export function etagFor(revision: number): string {
  return `"${revision}"`;
}

export function setEtag(reply: FastifyReply, revision: number): void {
  reply.header('etag', etagFor(revision));
}

/** Accepts `"3"`, `W/"3"` or a bare `3`. */
export function parseIfMatch(request: FastifyRequest): number {
  const raw = request.headers['if-match'];
  const value = (Array.isArray(raw) ? raw[0] : raw)?.trim();
  if (!value) throw problem('precondition_required');
  const match = /^(?:W\/)?"?(\d{1,9})"?$/.exec(value);
  if (!match) throw problem('precondition_failed', 'If-Match must be the current revision, e.g. "3".');
  return Number(match[1]);
}

/** Throws 412 when the stored revision is not the one the client edited. */
export function assertRevision(current: number, expected: number): void {
  if (current !== expected) {
    throw problem('precondition_failed', `The record is at revision ${current}; you edited revision ${expected}.`);
  }
}
