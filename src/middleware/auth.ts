/**
 * Aethene Authentication Middleware
 *
 * API key authentication with support for:
 * 1. Static API keys (API_KEYS env var) - for development
 * 2. Convex database validation - for production
 * 3. Scoped API keys with containerTag restrictions (Supermemory v3 compatible)
 */

import { Context, Next } from 'hono';
import { queryConvex } from '../database/db.js';

// =============================================================================
// TYPES
// =============================================================================

export type ApiKeyPermission = 'read' | 'write' | 'delete' | 'admin';

export interface AuthContext {
  userId: string;
  apiKey: string;
  rateLimit: number;
  keyProvider: 'static' | 'convex';
  // Scoped key context
  isScoped: boolean;
  containerTags: string[];
  permissions: ApiKeyPermission[];
}

interface ConvexApiKeyValidation {
  valid: boolean;
  userId?: string;
  rateLimit?: number;
  monthlyLimit?: number;
  requestsThisMonth?: number;
  // Scoped key fields
  isScoped?: boolean;
  containerTags?: string[];
  permissions?: string[];
}

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Extract API key from request headers
 */
function extractApiKey(c: Context): string | null {
  const headerKey = c.req.header('X-API-Key');
  if (headerKey) return headerKey;

  const authHeader = c.req.header('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }

  return null;
}

/**
 * Validate against static API keys (for development)
 */
function validateStaticApiKey(apiKey: string): { isValid: boolean; userId: string } {
  const staticKeys = process.env.API_KEYS?.split(',').map(k => k.trim()) || [];

  if (staticKeys.includes(apiKey)) {
    // Generate deterministic userId from API key suffix
    return { isValid: true, userId: `static-${apiKey.slice(-8)}` };
  }

  return { isValid: false, userId: '' };
}

/**
 * Validate against Convex database
 */
async function validateWithConvex(apiKey: string): Promise<ConvexApiKeyValidation | null> {
  try {
    const result = await queryConvex<ConvexApiKeyValidation>('apiKeys:validate', { key: apiKey });
    return result;
  } catch (error) {
    console.error('[Auth] Convex validation error:', error);
    return null;
  }
}

/**
 * Check if a containerTag is allowed for a scoped key
 */
export function isContainerTagAllowed(allowedTags: string[], requestedTag: string): boolean {
  if (allowedTags.length === 0) {
    return true; // No restrictions
  }
  return allowedTags.includes(requestedTag) || allowedTags.includes('*');
}

/**
 * Check if a permission is granted for a scoped key
 */
export function hasPermission(permissions: ApiKeyPermission[], required: ApiKeyPermission): boolean {
  if (permissions.includes('admin')) {
    return true; // Admin has all permissions
  }
  return permissions.includes(required);
}

// =============================================================================
// MIDDLEWARE
// =============================================================================

/**
 * API Key Authentication Middleware
 *
 * Validates X-API-Key header or Authorization: Bearer token
 * Sets userId, apiKey, rateLimit, keyProvider, and scoped key context in context
 */
export async function apiKeyAuth(c: Context, next: Next) {
  const apiKey = extractApiKey(c);

  if (!apiKey) {
    return c.json(
      {
        success: false,
        error: 'Missing API key',
        message: 'Provide API key via X-API-Key header or Authorization: Bearer token',
      },
      401
    );
  }

  try {
    // 1. Check static API keys first (fastest, for development)
    const staticValidation = validateStaticApiKey(apiKey);
    if (staticValidation.isValid) {
      c.set('userId', staticValidation.userId);
      c.set('apiKey', apiKey);
      c.set('rateLimit', 1000);
      c.set('keyProvider', 'static');
      // Static keys have full access
      c.set('isScoped', false);
      c.set('containerTags', []);
      c.set('permissions', ['read', 'write', 'delete', 'admin']);
      await next();
      return;
    }

    // 2. Validate with Convex database
    const convexValidation = await validateWithConvex(apiKey);
    if (convexValidation?.valid && convexValidation.userId) {
      c.set('userId', convexValidation.userId);
      c.set('apiKey', apiKey);
      c.set('rateLimit', convexValidation.rateLimit || 100);
      c.set('keyProvider', 'convex');
      // Set scoped key context
      c.set('isScoped', convexValidation.isScoped || false);
      c.set('containerTags', convexValidation.containerTags || []);
      c.set('permissions', (convexValidation.permissions || ['read', 'write', 'delete', 'admin']) as ApiKeyPermission[]);
      await next();
      return;
    }

    // Invalid API key
    return c.json(
      {
        success: false,
        error: 'Invalid API key',
        message: 'The provided API key is not valid',
      },
      401
    );
  } catch (error) {
    console.error('[Auth] Middleware error:', error);
    return c.json(
      {
        success: false,
        error: 'Authentication error',
        message: 'An error occurred during authentication',
      },
      500
    );
  }
}

/**
 * Optional Auth - doesn't block if no API key provided
 * Useful for public endpoints that optionally use auth
 */
export async function optionalAuth(c: Context, next: Next) {
  const apiKey = extractApiKey(c);

  if (!apiKey) {
    c.set('userId', null);
    await next();
    return;
  }

  // Has API key, validate it
  try {
    const staticValidation = validateStaticApiKey(apiKey);
    if (staticValidation.isValid) {
      c.set('userId', staticValidation.userId);
      c.set('apiKey', apiKey);
      c.set('keyProvider', 'static');
      await next();
      return;
    }

    const convexValidation = await validateWithConvex(apiKey);
    if (convexValidation?.valid && convexValidation.userId) {
      c.set('userId', convexValidation.userId);
      c.set('apiKey', apiKey);
      c.set('keyProvider', 'convex');
      c.set('isScoped', convexValidation.isScoped || false);
      c.set('containerTags', convexValidation.containerTags || []);
      c.set('permissions', (convexValidation.permissions || ['read', 'write', 'delete', 'admin']) as ApiKeyPermission[]);
      await next();
      return;
    }

    // Invalid API key - proceed without auth
    c.set('userId', null);
  } catch (error) {
    console.error('[Auth] Optional auth error:', error);
    c.set('userId', null);
  }

  await next();
}

// =============================================================================
// SCOPED KEY MIDDLEWARE
// =============================================================================

/**
 * Middleware factory to require specific permission
 * Use after apiKeyAuth middleware
 *
 * @example
 * app.post('/v3/documents', apiKeyAuth, requirePermission('write'), handler);
 */
export function requirePermission(permission: ApiKeyPermission) {
  return async (c: Context, next: Next) => {
    const permissions = c.get('permissions') as ApiKeyPermission[] | undefined;

    if (!permissions) {
      return c.json({
        success: false,
        error: 'Unauthorized',
        message: 'Authentication required',
      }, 401);
    }

    if (!hasPermission(permissions, permission)) {
      return c.json({
        success: false,
        error: 'Forbidden',
        message: `This API key lacks the '${permission}' permission`,
        code: 'INSUFFICIENT_PERMISSIONS',
      }, 403);
    }

    await next();
  };
}

/**
 * Middleware to validate containerTag access for scoped keys
 * Extracts containerTag from body or query and validates against key's allowed tags
 *
 * @example
 * app.post('/v3/documents', apiKeyAuth, validateContainerAccess, handler);
 */
export async function validateContainerAccess(c: Context, next: Next) {
  const isScoped = c.get('isScoped');
  const allowedTags = c.get('containerTags') as string[] | undefined;

  // Non-scoped keys have full access
  if (!isScoped || !allowedTags || allowedTags.length === 0) {
    await next();
    return;
  }

  // Try to extract containerTag from request
  let requestedTag: string | null = null;

  // Check query params first
  requestedTag = c.req.query('containerTag') || null;

  // Check body for POST/PATCH requests
  if (!requestedTag && ['POST', 'PATCH', 'PUT'].includes(c.req.method)) {
    try {
      const body = await c.req.json();
      requestedTag = body.containerTag || body.containerTags?.[0] || null;
      // Re-parse body since we consumed it - store in context for handlers
      c.set('parsedBody', body);
    } catch {
      // Body parsing failed or no body
    }
  }

  // If no containerTag in request but key is scoped, default to first allowed tag
  if (!requestedTag && allowedTags.length > 0) {
    // Allow the request but note that responses will be filtered
    await next();
    return;
  }

  // Validate access
  if (requestedTag && !isContainerTagAllowed(allowedTags, requestedTag)) {
    return c.json({
      success: false,
      error: 'Forbidden',
      message: `This API key does not have access to containerTag '${requestedTag}'`,
      code: 'CONTAINER_ACCESS_DENIED',
      allowedTags,
    }, 403);
  }

  await next();
}

// =============================================================================
// UTILITIES
// =============================================================================

/**
 * Get user ID from context (set by auth middleware)
 */
export function getUserId(c: Context): string | null {
  return c.get('userId') || null;
}

/**
 * Require authenticated user (throws if not authenticated)
 */
export function requireUserId(c: Context): string {
  const userId = getUserId(c);
  if (!userId) {
    throw new Error('User not authenticated');
  }
  return userId;
}

/**
 * Get scoped key context from request
 */
export function getScopedKeyContext(c: Context): {
  isScoped: boolean;
  containerTags: string[];
  permissions: ApiKeyPermission[];
} {
  return {
    isScoped: c.get('isScoped') || false,
    containerTags: c.get('containerTags') || [],
    permissions: c.get('permissions') || ['read', 'write', 'delete', 'admin'],
  };
}

/**
 * Validate and resolve userId for requests
 *
 * SECURITY: Prevents IDOR attacks by only allowing userId override when:
 * 1. The API key has 'admin' permission, OR
 * 2. The requested userId matches an allowed containerTag for scoped keys
 *
 * @param c - Hono context
 * @param requestedUserId - userId from request body/query (optional)
 * @returns The validated userId to use for the operation
 */
export function resolveUserId(c: Context, requestedUserId?: string | null): string {
  const authUserId = c.get('userId') as string;
  const permissions = c.get('permissions') as ApiKeyPermission[] | undefined;
  const containerTags = c.get('containerTags') as string[] | undefined;
  const isScoped = c.get('isScoped') as boolean | undefined;

  // No override requested - use auth userId
  if (!requestedUserId || requestedUserId === authUserId) {
    return authUserId;
  }

  // Admin keys can access any userId
  if (permissions?.includes('admin')) {
    return requestedUserId;
  }

  // Scoped keys can only access their allowed containerTags
  if (isScoped && containerTags && containerTags.length > 0) {
    if (containerTags.includes(requestedUserId) || containerTags.includes('*')) {
      return requestedUserId;
    }
    // Not allowed - fall back to auth userId
    console.warn(`[Auth] IDOR attempt blocked: key tried to access userId '${requestedUserId}' but only has access to [${containerTags.join(', ')}]`);
    return authUserId;
  }

  // Non-scoped, non-admin keys cannot override userId
  console.warn(`[Auth] IDOR attempt blocked: non-admin key tried to access userId '${requestedUserId}'`);
  return authUserId;
}
