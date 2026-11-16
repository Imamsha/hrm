import type { RedisOptions } from 'ioredis';

/**
 * Converts a redis:// URL to ioredis options for BullMQ.
 * BullMQ workers require `maxRetriesPerRequest: null` (blocking commands must not time out).
 */
export function bullConnectionFromUrl(redisUrl: string): RedisOptions {
  const url = new URL(redisUrl);
  const db = url.pathname.length > 1 ? Number.parseInt(url.pathname.slice(1), 10) : 0;
  return {
    host: url.hostname,
    port: url.port ? Number.parseInt(url.port, 10) : 6379,
    ...(url.username ? { username: decodeURIComponent(url.username) } : {}),
    ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
    db: Number.isNaN(db) ? 0 : db,
    ...(url.protocol === 'rediss:' ? { tls: {} } : {}),
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  };
}
