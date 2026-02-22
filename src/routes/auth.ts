/**
 * Auth Routes for Aethene API
 * API key management endpoints
 *
 * POST /v1/auth/keys - Create a scoped API key
 * GET /v1/auth/keys - List API keys
 * PATCH /v1/auth/keys/:id - Update an API key
 * DELETE /v1/auth/keys/:id - Revoke an API key
 * GET /v1/auth/key-info - Get current key info
 */

import { Hono } from 'hono';
import type { AppEnv } from '../types/hono.js';
import { z } from 'zod';
import { randomBytes } from 'crypto';
import { mutateConvex, queryConvex } from '../database/db.js';
import {
  authenticationError,
  notFoundError,
  internalError,
  validationError,
} from '../utils/errors.js';

const auth = new Hono<AppEnv>();

// =============================================================================
// SCHEMAS
// =============================================================================

const PermissionSchema = z.enum(['read', 'write', 'delete', 'admin']);

const CreateScopedKeySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  containerTags: z.array(z.string().min(1).max(100)).min(1).max(50),
  permissions: z.array(PermissionSchema).min(1).default(['read']),
  rateLimit: z.number().min(1).max(100000).optional(),
  monthlyLimit: z.number().min(1).max(10000000).optional(),
  expiresIn: z.number().min(60).max(31536000).optional(), // 1 minute to 1 year in seconds
});

const UpdateScopedKeySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  containerTags: z.array(z.string().min(1).max(100)).min(1).max(50).optional(),
  permissions: z.array(PermissionSchema).min(1).optional(),
  rateLimit: z.number().min(1).max(100000).optional(),
  monthlyLimit: z.number().min(1).max(10000000).optional(),
  expiresAt: z.number().optional(),
  isActive: z.boolean().optional(),
});

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Generate a secure API key
 */
function generateApiKey(prefix: string = 'sk'): string {
  const bytes = randomBytes(24);
  const key = bytes.toString('base64url');
  return `${prefix}_${key}`;
}

// =============================================================================
// POST /v1/auth/keys - Create scoped API key
// =============================================================================

auth.post('/keys', async (c) => {
  const userId = c.get('userId');
  const parentApiKey = c.get('apiKey');
  const isScoped = c.get('isScoped');

  if (!userId) {
    return authenticationError(c);
  }

  // Scoped keys cannot create other scoped keys
  if (isScoped) {
    return c.json({
      success: false,
      error: 'Forbidden',
      message: 'Scoped API keys cannot create other scoped keys',
      code: 'SCOPED_KEY_RESTRICTION',
    }, 403);
  }

  let body: z.infer<typeof CreateScopedKeySchema>;
  try {
    const raw = await c.req.json();
    body = CreateScopedKeySchema.parse(raw);
  } catch (error: any) {
    return validationError(c, error.message || 'Invalid request body');
  }

  try {
    // Generate a new scoped key
    const newKey = generateApiKey('sk_scoped');

    // Calculate expiration
    const expiresAt = body.expiresIn
      ? Date.now() + (body.expiresIn * 1000)
      : undefined;

    // SECURITY FIX: Scoped keys get their own userId based on containerTags
    // This ensures complete data isolation between different scoped keys
    const scopedUserId = `scoped-${body.containerTags.sort().join('-')}`;

    // Create the scoped key in database
    const keyId = await mutateConvex<string>('apiKeys:createScopedKey', {
      key: newKey,
      parentKeyId: parentApiKey,
      userId: scopedUserId,  // Use scoped userId instead of parent's
      parentUserId: userId,  // Keep reference to parent for management
      name: body.name,
      description: body.description,
      containerTags: body.containerTags,
      permissions: body.permissions,
      rateLimit: body.rateLimit,
      monthlyLimit: body.monthlyLimit,
      expiresAt,
    });

    if (!keyId) {
      return internalError(c, new Error('Failed to create scoped key'), 'create scoped key');
    }

    // Return Supermemory-compatible response
    return c.json({
      success: true,
      key: newKey,
      id: keyId,
      name: body.name || null,
      description: body.description || null,
      containerTags: body.containerTags,
      permissions: body.permissions,
      rateLimit: body.rateLimit || null,
      monthlyLimit: body.monthlyLimit || null,
      expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
      createdAt: new Date().toISOString(),
      message: 'Scoped API key created. Store this key securely - it will not be shown again.',
    }, 201);
  } catch (error: any) {
    if (error.message?.includes('containerTag')) {
      return validationError(c, error.message);
    }
    if (error.message?.includes('permission')) {
      return validationError(c, error.message);
    }
    return internalError(c, error, 'create scoped key');
  }
});

// =============================================================================
// GET /v1/auth/keys - List scoped API keys
// =============================================================================

auth.get('/keys', async (c) => {
  const userId = c.get('userId');
  const parentApiKey = c.get('apiKey');
  const isScoped = c.get('isScoped');

  if (!userId) {
    return authenticationError(c);
  }

  // Scoped keys can only see their own info
  if (isScoped) {
    return c.json({
      success: true,
      keys: [],
      message: 'Scoped API keys cannot list other scoped keys',
    });
  }

  try {
    interface ScopedKeyRecord {
      _id: string;
      name?: string;
      description?: string;
      container_tags?: string[];
      permissions?: string[];
      rate_limit?: number;
      monthly_limit?: number;
      requests_this_month?: number;
      is_active: boolean;
      expires_at?: number;
      created_at: number;
      last_used_at?: number;
    }

    const scopedKeys = await queryConvex<ScopedKeyRecord[]>('apiKeys:getScopedKeys', {
      parentKeyId: parentApiKey,
    });

    const keys = (scopedKeys || []).map((k) => ({
      id: k._id,
      name: k.name || null,
      description: k.description || null,
      containerTags: k.container_tags || [],
      permissions: k.permissions || [],
      rateLimit: k.rate_limit || null,
      monthlyLimit: k.monthly_limit || null,
      requestsThisMonth: k.requests_this_month || 0,
      isActive: k.is_active,
      expiresAt: k.expires_at ? new Date(k.expires_at).toISOString() : null,
      createdAt: new Date(k.created_at).toISOString(),
      lastUsedAt: k.last_used_at ? new Date(k.last_used_at).toISOString() : null,
    }));

    return c.json({
      success: true,
      keys,
      total: keys.length,
    });
  } catch (error) {
    return internalError(c, error, 'list scoped keys');
  }
});

// =============================================================================
// PATCH /v1/auth/keys/:id - Update scoped API key
// =============================================================================

auth.patch('/keys/:id', async (c) => {
  const userId = c.get('userId');
  const isScoped = c.get('isScoped');

  if (!userId) {
    return authenticationError(c);
  }

  // Scoped keys cannot update other keys
  if (isScoped) {
    return c.json({
      success: false,
      error: 'Forbidden',
      message: 'Scoped API keys cannot modify other scoped keys',
      code: 'SCOPED_KEY_RESTRICTION',
    }, 403);
  }

  const keyId = c.req.param('id');

  let body: z.infer<typeof UpdateScopedKeySchema>;
  try {
    const raw = await c.req.json();
    body = UpdateScopedKeySchema.parse(raw);
  } catch (error: any) {
    return validationError(c, error.message || 'Invalid request body');
  }

  // Check that at least one field is provided
  if (Object.keys(body).length === 0) {
    return validationError(c, 'At least one field must be provided');
  }

  try {
    interface UpdatedKey {
      _id: string;
      name?: string;
      description?: string;
      container_tags?: string[];
      permissions?: string[];
      rate_limit?: number;
      monthly_limit?: number;
      is_active: boolean;
      expires_at?: number;
      created_at: number;
    }

    const updated = await mutateConvex<UpdatedKey>('apiKeys:updateScopedKey', {
      id: keyId,
      parentUserId: userId,
      name: body.name,
      description: body.description,
      containerTags: body.containerTags,
      permissions: body.permissions,
      rateLimit: body.rateLimit,
      monthlyLimit: body.monthlyLimit,
      expiresAt: body.expiresAt,
      isActive: body.isActive,
    });

    if (!updated) {
      return notFoundError(c, 'Scoped API key');
    }

    return c.json({
      success: true,
      id: updated._id,
      name: updated.name || null,
      description: updated.description || null,
      containerTags: updated.container_tags || [],
      permissions: updated.permissions || [],
      rateLimit: updated.rate_limit || null,
      monthlyLimit: updated.monthly_limit || null,
      isActive: updated.is_active,
      expiresAt: updated.expires_at ? new Date(updated.expires_at).toISOString() : null,
      updatedAt: new Date().toISOString(),
    });
  } catch (error: any) {
    if (error.message === 'API key not found') {
      return notFoundError(c, 'Scoped API key');
    }
    if (error.message?.includes('Access denied')) {
      return c.json({
        success: false,
        error: 'Forbidden',
        message: 'You do not own this API key',
        code: 'ACCESS_DENIED',
      }, 403);
    }
    if (error.message?.includes('not a scoped key')) {
      return validationError(c, 'This key is not a scoped key');
    }
    return internalError(c, error, 'update scoped key');
  }
});

// =============================================================================
// DELETE /v1/auth/keys/:id - Revoke scoped API key
// =============================================================================

auth.delete('/keys/:id', async (c) => {
  const userId = c.get('userId');
  const isScoped = c.get('isScoped');

  if (!userId) {
    return authenticationError(c);
  }

  // Scoped keys cannot revoke other keys
  if (isScoped) {
    return c.json({
      success: false,
      error: 'Forbidden',
      message: 'Scoped API keys cannot revoke other scoped keys',
      code: 'SCOPED_KEY_RESTRICTION',
    }, 403);
  }

  const keyId = c.req.param('id');

  try {
    const result = await mutateConvex<{ success: boolean }>('apiKeys:revokeScopedKey', {
      id: keyId,
      parentUserId: userId,
    });

    if (!result?.success) {
      return notFoundError(c, 'Scoped API key');
    }

    return c.json({
      success: true,
      message: 'Scoped API key revoked',
      id: keyId,
    });
  } catch (error: any) {
    if (error.message === 'API key not found') {
      return notFoundError(c, 'Scoped API key');
    }
    if (error.message?.includes('Access denied')) {
      return c.json({
        success: false,
        error: 'Forbidden',
        message: 'You do not own this API key',
        code: 'ACCESS_DENIED',
      }, 403);
    }
    if (error.message?.includes('not a scoped key')) {
      return validationError(c, 'This key is not a scoped key');
    }
    return internalError(c, error, 'revoke scoped key');
  }
});

// =============================================================================
// GET /v1/auth/key-info - Get current API key info
// =============================================================================

auth.get('/key-info', async (c) => {
  const userId = c.get('userId');
  const isScoped = c.get('isScoped');
  const containerTags = c.get('containerTags');
  const permissions = c.get('permissions');
  const rateLimit = c.get('rateLimit');

  if (!userId) {
    return authenticationError(c);
  }

  return c.json({
    success: true,
    userId,
    isScoped: isScoped || false,
    containerTags: containerTags || [],
    permissions: permissions || ['read', 'write', 'delete', 'admin'],
    rateLimit: rateLimit || null,
  });
});

export default auth;
