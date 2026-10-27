import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

export const REQUEST_ID_HEADER = 'x-request-id';

// Accept a caller-supplied id only if it is short and log-safe; otherwise mint a fresh UUID so a
// client cannot inject arbitrary text into logs or audit rows.
const ACCEPTABLE_REQUEST_ID = /^[A-Za-z0-9._:-]{8,128}$/;

/** Fastify `genReqId`: the request id doubles as the correlation id in logs, audit and errors. */
export function generateRequestId(req: IncomingMessage): string {
  const header = req.headers[REQUEST_ID_HEADER];
  const candidate = Array.isArray(header) ? header[0] : header;
  return candidate && ACCEPTABLE_REQUEST_ID.test(candidate) ? candidate : randomUUID();
}
