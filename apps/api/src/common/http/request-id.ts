import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { RequestContext } from '../context/request-context.js';

export const REQUEST_ID_HEADER = 'x-request-id';

/** Accept caller-supplied IDs only if they are short and log-safe; otherwise mint one. */
const SAFE_ID = /^[A-Za-z0-9._:-]{8,64}$/;

export function resolveRequestId(incoming: string | string[] | undefined): string {
  const value = Array.isArray(incoming) ? incoming[0] : incoming;
  return value && SAFE_ID.test(value) ? value : randomUUID();
}

type RequestWithId = IncomingMessage & { id?: string };

/**
 * First middleware in the chain: assigns the request ID, echoes it in the response
 * and opens the AsyncLocalStorage request context for the rest of the request.
 */
export function requestContextMiddleware(
  req: RequestWithId,
  res: ServerResponse,
  next: () => void,
): void {
  const requestId = resolveRequestId(req.headers[REQUEST_ID_HEADER]);
  req.id = requestId;
  res.setHeader(REQUEST_ID_HEADER, requestId);
  const userAgent = req.headers['user-agent'];
  RequestContext.run(
    {
      requestId,
      ...(req.socket.remoteAddress ? { ipAddress: req.socket.remoteAddress } : {}),
      ...(userAgent ? { userAgent: userAgent.slice(0, 512) } : {}),
    },
    next,
  );
}
