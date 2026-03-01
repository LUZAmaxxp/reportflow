import Redis from "ioredis";

export const API_RATE_LIMIT_PER_MINUTE = 100;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

let _redis: Redis | null = null;

function getRedis(): Redis {
  if (!_redis) {
    _redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
      enableOfflineQueue: false,
    });
    _redis.on("error", () => {
      /* swallow — rate limiting should not crash the app */
    });
  }
  return _redis;
}

/**
 * Sliding minute window counter using Redis INCR + EXPIRE.
 * Key pattern: rl:{user_id}:{minute_bucket}
 */
export async function checkRateLimit(userId: string): Promise<RateLimitResult> {
  try {
    const redis = getRedis();
    const minuteBucket = Math.floor(Date.now() / 60000);
    const key = `rl:${userId}:${minuteBucket}`;

    const current = await redis.incr(key);
    if (current === 1) {
      // First request in this minute — set expiry to 60s
      await redis.expire(key, 60);
    }

    const allowed = current <= API_RATE_LIMIT_PER_MINUTE;
    const remaining = Math.max(0, API_RATE_LIMIT_PER_MINUTE - current);
    const retryAfterSeconds = allowed ? 0 : 60 - (Math.floor(Date.now() / 1000) % 60);

    return { allowed, remaining, retryAfterSeconds };
  } catch {
    // On Redis failure, allow the request (fail-open)
    return { allowed: true, remaining: API_RATE_LIMIT_PER_MINUTE, retryAfterSeconds: 0 };
  }
}
