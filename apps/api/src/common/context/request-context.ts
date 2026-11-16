import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Per-request ambient context. Populated by middleware at the edge of the request
 * and readable anywhere downstream (services, repositories, audit, logging) without
 * threading parameters through every call.
 *
 * `organizationId` / `userId` are set only by trusted server-side code (authentication
 * in Phase 02). They are NEVER taken from client-supplied headers or bodies.
 */
export interface RequestContextState {
  requestId: string;
  organizationId?: string;
  userId?: string;
  /** Authenticated session (refresh-token family) id. */
  sessionId?: string;
  /** Active membership in `organizationId`, verified against the database for this request. */
  membershipId?: string;
  ipAddress?: string;
  userAgent?: string;
}

const storage = new AsyncLocalStorage<RequestContextState>();

export const RequestContext = {
  run<T>(state: RequestContextState, fn: () => T): T {
    return storage.run(state, fn);
  },

  get(): RequestContextState | undefined {
    return storage.getStore();
  },

  requestId(): string | undefined {
    return storage.getStore()?.requestId;
  },

  /** Mutates the current context (e.g. after authentication resolves the tenant). */
  patch(partial: Partial<Omit<RequestContextState, 'requestId'>>): void {
    const store = storage.getStore();
    if (!store) throw new Error('RequestContext.patch called outside of a request context');
    Object.assign(store, partial);
  },
};
