/**
 * Aethene Rate Limiting Middleware
 *
 * Simple in-memory sliding window rate limiting
 */

import { Context, Next } from 'hono';

// =============================================================================
// TYPES
// =============================================================================

interface RateLimitConfig {
  windowMs: number;    // Time window in milliseconds
  maxRequests: number; // Max requests per window
  message?: string;    // Custom error message
}

interface RateLimitRecord {
  count: number;
  resetTime: number;
}

// =============================================================================
// STATE
// =============================================================================

// In-memory storage for rate limiting
const requestCounts = new Map<string, RateLimitRecord>();

// API keys that bypass rate limiting
const UNLIMITED_API_KEYS = new Set(
  (process.env.UNLIMITED_API_KEYS || '').split(',').filter(Boolean)
);

// =============================================================================
// MIDDLEWARE FACTORY
// =============================================================================

/**
 * Creates a rate limiter middleware with configurable limits
 *
 * @example
 * // 100 requests per minute
 * app.use('/api/*', rateLimiter({ windowMs: 60000, maxRequests: 100 }));
 */
export function rateLimiter(config: RateLimitConfig) {
  const { windowMs, maxRequests, message } = config;

  return async (c: Context, next: Next) => {
    // Get identifier (API key preferred, fallback to IP)
    const apiKey = c.get('apiKey') as string | undefined;
    const ip = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown';
    const identifier = apiKey || ip;

    // Bypass for unlimited API keys
    if (apiKey && UNLIMITED_API_KEYS.has(apiKey)) {
      await next();
      return;
    }

    const now = Date.now();
    const record = requestCounts.get(identifier);

    // Initialize or reset if window expired
    if (!record || now > record.resetTime) {
      requestCounts.set(identifier, {
        count: 1,
        resetTime: now + windowMs,
      });
      await next();
      return;
    }

    // Increment counter
    record.count++;

    // Check if limit exceeded
    if (record.count > maxRequests) {
      const retryAfter = Math.ceil((record.resetTime - now) / 1000);

      return c.json(
        {
          success: false,
          error: 'Rate limit exceeded',
          message: message || `Too many requests. Limit: ${maxRequests} per ${windowMs / 1000}s.`,
          retryAfter,
          limit: {
            max: maxRequests,
            windowSeconds: windowMs / 1000,
            current: record.count,
          },
        },
        429,
        {
          'Retry-After': retryAfter.toString(),
          'X-RateLimit-Limit': maxRequests.toString(),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': new Date(record.resetTime).toISOString(),
        }
      );
    }

    // Add rate limit headers
    c.header('X-RateLimit-Limit', maxRequests.toString());
    c.header('X-RateLimit-Remaining', (maxRequests - record.count).toString());
    c.header('X-RateLimit-Reset', new Date(record.resetTime).toISOString());

    await next();
  };
}

// =============================================================================
// PRE-CONFIGURED LIMITERS
// =============================================================================

/**
 * Global rate limiter: 1000 requests per 15 minutes
 */
export const globalRateLimiter = rateLimiter({
  windowMs: 15 * 60 * 1000,
  maxRequests: 1000,
  message: 'Too many requests. Please try again later.',
});

/**
 * Strict rate limiter: 100 requests per hour (for expensive operations)
 */
export const strictRateLimiter = rateLimiter({
  windowMs: 60 * 60 * 1000,
  maxRequests: 100,
  message: 'Rate limit exceeded for this operation.',
});

// =============================================================================
// PER-KEY RATE LIMITER (For scoped API keys)
// =============================================================================

/**
 * Per-key rate limiter middleware
 * Uses the key's configured rate limit (set in auth context)
 * Falls back to default limit if not configured
 *
 * Must be used AFTER apiKeyAuth middleware
 */
export async function perKeyRateLimiter(c: Context, next: Next) {
  const apiKey = c.get('apiKey') as string | undefined;
  const keyRateLimit = c.get('rateLimit') as number | undefined;
  const ip = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown';
  const identifier = apiKey || ip;

  // Bypass for unlimited API keys
  if (apiKey && UNLIMITED_API_KEYS.has(apiKey)) {
    await next();
    return;
  }

  // Use key's rate limit or default to 100 per hour
  const maxRequests = keyRateLimit || 100;
  const windowMs = 60 * 60 * 1000; // 1 hour window

  const now = Date.now();
  const recordKey = `perkey:${identifier}`;
  const record = requestCounts.get(recordKey);

  // Initialize or reset if window expired
  if (!record || now > record.resetTime) {
    requestCounts.set(recordKey, {
      count: 1,
      resetTime: now + windowMs,
    });

    // Add rate limit headers
    c.header('X-RateLimit-Limit', maxRequests.toString());
    c.header('X-RateLimit-Remaining', (maxRequests - 1).toString());
    c.header('X-RateLimit-Reset', new Date(now + windowMs).toISOString());

    await next();
    return;
  }

  // Increment counter
  record.count++;

  // Check if limit exceeded
  if (record.count > maxRequests) {
    const retryAfter = Math.ceil((record.resetTime - now) / 1000);

    return c.json(
      {
        success: false,
        error: 'Rate limit exceeded',
        message: `API key rate limit exceeded. Limit: ${maxRequests} per hour.`,
        code: 'RATE_LIMIT_EXCEEDED',
        retryAfter,
        limit: {
          max: maxRequests,
          windowSeconds: windowMs / 1000,
          current: record.count,
        },
      },
      429,
      {
        'Retry-After': retryAfter.toString(),
        'X-RateLimit-Limit': maxRequests.toString(),
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': new Date(record.resetTime).toISOString(),
      }
    );
  }

  // Add rate limit headers
  c.header('X-RateLimit-Limit', maxRequests.toString());
  c.header('X-RateLimit-Remaining', (maxRequests - record.count).toString());
  c.header('X-RateLimit-Reset', new Date(record.resetTime).toISOString());

  await next();
}

// =============================================================================
// CLEANUP
// =============================================================================

/**
 * Clean up expired rate limit records
 * Call periodically to prevent memory leaks
 */
export function cleanupRateLimitRecords(): number {
  const now = Date.now();
  let cleaned = 0;

  for (const [key, record] of requestCounts.entries()) {
    if (now > record.resetTime) {
      requestCounts.delete(key);
      cleaned++;
    }
  }

  return cleaned;
}
