/**
 * Redis connection — CBC Learning Ecosystem
 *
 * Used for: session cache, M-Pesa queue (Bull), rate-limiter state.
 * Prefers REDIS_URL (Railway auto-injects this when Redis service is linked).
 */

import Redis from 'ioredis';
import { logger } from '../utils/logger';

function createRedisClient(): Redis {
  const url = process.env.REDIS_URL;

  const client = url
    ? new Redis(url, { maxRetriesPerRequest: 3, enableReadyCheck: false })
    : new Redis({
      host:     process.env.REDIS_HOST     || 'localhost',
      port:     parseInt(process.env.REDIS_PORT || '6379', 10),
      password: process.env.REDIS_PASSWORD  || undefined,
      maxRetriesPerRequest: 3,
      enableReadyCheck: false,
    });

  client.on('connect',   () => logger.info('[redis] ✅ Redis connected'));
  client.on('error',     (err) => logger.error('[redis] Redis error', { error: err.message }));
  client.on('reconnecting', () => logger.warn('[redis] Redis reconnecting…'));

  return client;
}

export const redis = createRedisClient();
