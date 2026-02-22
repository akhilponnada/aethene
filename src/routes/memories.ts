/**
 * Memories Routes for Aethene API
 * /v1/memories - Memory management with LLM extraction
 *
 * Memory = atomic fact/knowledge unit
 * - Core memories (isCore=true): Named entity facts like "Sarah Johnson is 28 years old"
 * - Dynamic memories (isCore=false): User-prefixed facts like "User prefers dark mode"
 *
 * NOTE: POST /v1/memories now uses LLM extraction to atomize content into proper facts.
 * This ensures consistent behavior with /v1/content endpoint.
 */

import { Hono } from 'hono';
import type { AppEnv } from '../types/hono.js';
import {
  CreateMemoriesSchema,
  UpdateMemorySchema,
  ListMemoriesQuerySchema,
  BatchForgetSchema,
} from '../types/schemas.js';
import {
  authenticationError,
  authorizationError,
  notFoundError,
  internalError,
  validateBody,
  validateQuery,
} from '../utils/errors.js';
import { resolveUserId } from '../middleware/auth.js';

const memories = new Hono<AppEnv>();

// =============================================================================
// POST /v1/memories - Create memories directly (batch)
// =============================================================================

memories.post('/', async (c) => {
  const startTime = Date.now();

  const authUserId = c.get('userId');
  if (!authUserId) {
    return authenticationError(c);
  }

  const body = await validateBody(c, CreateMemoriesSchema);

  // SECURITY: Validate userId override to prevent IDOR attacks
  const requestedUserId = (body as any).userId || (body as any).containerTag;
  const userId = resolveUserId(c, requestedUserId);

  try {
    const { extractAndSaveMemories } = await import('../services/memory-extractor.js');

    const created: Array<{ id: string; content: string; isCore: boolean }> = [];

    for (const memory of body.memories) {
      if (!memory.content.trim()) continue;

      // Use LLM extraction to atomize content into proper memory facts
      const result = await extractAndSaveMemories(userId, memory.content.trim(), {
        forceIsCore: memory.isCore,
        metadata: memory.metadata || undefined,
      });

      // Collect all created memories
      for (const createdMemory of result.memories) {
        created.push({
          id: createdMemory.id,
          content: createdMemory.content,
          isCore: createdMemory.isCore,
        });
      }
    }

    return c.json({
      success: true,
      created: created.length,
      memories: created,
      latencyMs: Date.now() - startTime,
    }, 201);
  } catch (error) {
    return internalError(c, error, 'Memories create');
  }
});

// =============================================================================
// GET /v1/memories - List user's memories
// =============================================================================

memories.get('/', async (c) => {
  const authUserId = c.get('userId');
  if (!authUserId) {
    return authenticationError(c);
  }

  const query = validateQuery(c, ListMemoriesQuerySchema);

  // SECURITY: Validate userId override to prevent IDOR attacks
  const userId = resolveUserId(c, query.userId);

  try {
    const { getConvexClient } = await import('../database/convex.js');
    const convex = getConvexClient();

    // Build query args (Convex uses camelCase)
    const args: Record<string, unknown> = {
      userId: userId,
      limit: query.limit,
    };

    if (query.isCore === 'true') {
      args.isCore = true;
    } else if (query.isCore === 'false') {
      args.isCore = false;
    }

    const memoryList = await convex.query('memories:getByUser' as any, args as any);

    const results = (memoryList as any[] || []).map((m: any) => ({
      id: m._id,
      content: m.content,
      isCore: m.is_core || false,
      version: m.version || 1,
      createdAt: new Date(m.created_at || m._creationTime).toISOString(),
      updatedAt: new Date(m.updated_at || m._creationTime).toISOString(),
      isDeleted: m.is_forgotten || false,
      metadata: m.metadata || null,
    }));

    return c.json({
      memories: results,
      count: results.length,
      hasMore: results.length === query.limit,
    });
  } catch (error) {
    return internalError(c, error, 'Memories list');
  }
});

// =============================================================================
// GET /v1/memories/:id - Get specific memory
// =============================================================================

memories.get('/:id', async (c) => {
  const userId = c.get('userId');
  if (!userId) {
    return authenticationError(c);
  }

  const id = c.req.param('id');

  try {
    const { getConvexClient } = await import('../database/convex.js');
    const convex = getConvexClient();

    const memory = await convex.query('memories:getById' as any, { id });

    if (!memory) {
      return notFoundError(c, 'Memory');
    }

    const m = memory as any;
    if (m.user_id !== userId) {
      return authorizationError(c);
    }

    return c.json({
      id: m._id,
      content: m.content,
      isCore: m.is_core || false,
      version: m.version || 1,
      createdAt: new Date(m.created_at || m._creationTime).toISOString(),
      updatedAt: new Date(m.updated_at || m._creationTime).toISOString(),
      isDeleted: m.is_forgotten || false,
      metadata: m.metadata || null,
      sourceDocument: m.source_document || null,
    });
  } catch (error) {
    return internalError(c, error, 'Memory get');
  }
});

// =============================================================================
// PATCH /v1/memories/:id - Update memory (creates new version)
// =============================================================================

memories.patch('/:id', async (c) => {
  const startTime = Date.now();

  const userId = c.get('userId');
  if (!userId) {
    return authenticationError(c);
  }

  const id = c.req.param('id');
  const body = await validateBody(c, UpdateMemorySchema);
  

  try {
    const { embedText } = await import('../vector/embeddings.js');
    const { getConvexClient } = await import('../database/convex.js');

    const convex = getConvexClient();

    // Get existing memory
    const existing = await convex.query('memories:getById' as any, { id });

    if (!existing) {
      return notFoundError(c, 'Memory');
    }

    const ex = existing as any;
    if (ex.user_id !== userId) {
      return authorizationError(c);
    }

    // Generate new embedding for updated content
    const embedding = await embedText(body.content);
    const newVersion = (ex.version || 1) + 1;

    // Use the Convex update mutation which handles versioning internally
    // It marks old as not latest and creates new version
    const newId = await convex.mutation('memories:update' as any, {
      id,
      content: body.content.trim(),
      metadata: body.metadata || ex.metadata,
      embedding,
    });

    return c.json({
      success: true,
      id: newId,
      previousId: id,
      version: newVersion,
      latencyMs: Date.now() - startTime,
    });
  } catch (error) {
    return internalError(c, error, 'Memory update');
  }
});

// =============================================================================
// DELETE /v1/memories/:id - Soft delete (forget)
// =============================================================================

memories.delete('/:id', async (c) => {
  const userId = c.get('userId');
  if (!userId) {
    return authenticationError(c);
  }

  const id = c.req.param('id');

  try {
    const { getConvexClient } = await import('../database/convex.js');
    const convex = getConvexClient();

    // Get memory to verify ownership
    const memory = await convex.query('memories:getById' as any, { id });

    if (!memory) {
      return notFoundError(c, 'Memory');
    }

    const m = memory as any;
    if (m.user_id !== userId) {
      return authorizationError(c);
    }

    // Soft delete (mark as forgotten) using the forget mutation
    await convex.mutation('memories:forget' as any, { id });

    return c.json({
      success: true,
      message: 'Memory forgotten',
      id,
    });
  } catch (error) {
    return internalError(c, error, 'Memory delete');
  }
});

// =============================================================================
// GET /v1/memories/stats - Get memory statistics
// =============================================================================

memories.get('/stats', async (c) => {
  const userId = c.get('userId');
  if (!userId) {
    return authenticationError(c);
  }

  try {
    const { queryConvex } = await import('../database/db.js');

    const stats = await queryConvex<{
      total: number;
      core: number;
      recent: number;
      forgotten: number;
      versioned: number;
      active: number;
    }>('memoryOps:getStats', { userId });

    return c.json({
      stats: stats || {
        total: 0,
        core: 0,
        recent: 0,
        forgotten: 0,
        versioned: 0,
        active: 0,
      },
    });
  } catch (error) {
    return internalError(c, error, 'Memory stats');
  }
});

// =============================================================================
// GET /v1/memories/:id/history - Get version history
// =============================================================================

memories.get('/:id/history', async (c) => {
  const userId = c.get('userId');
  if (!userId) {
    return authenticationError(c);
  }

  const id = c.req.param('id');

  try {
    const { getVersionHistory } = await import('../services/memory-operations.js');

    const history = await getVersionHistory(userId, id);

    return c.json({
      memoryId: id,
      versions: history,
      count: history.length,
    });
  } catch (error: any) {
    if (error.message === 'Memory not found') {
      return notFoundError(c, 'Memory');
    }
    if (error.message.includes('Access denied')) {
      return authorizationError(c);
    }
    return internalError(c, error, 'Memory history');
  }
});

// =============================================================================
// POST /v1/memories/:id/restore - Restore forgotten memory
// =============================================================================

memories.post('/:id/restore', async (c) => {
  const userId = c.get('userId');
  if (!userId) {
    return authenticationError(c);
  }

  const id = c.req.param('id');

  try {
    const { restoreMemory } = await import('../services/memory-operations.js');

    await restoreMemory(userId, id);

    return c.json({
      success: true,
      message: 'Memory restored',
      id,
    });
  } catch (error: any) {
    if (error.message === 'Memory not found') {
      return notFoundError(c, 'Memory');
    }
    if (error.message.includes('Access denied')) {
      return authorizationError(c);
    }
    return internalError(c, error, 'Memory restore');
  }
});

// =============================================================================
// POST /v1/memories/:id/promote - Promote to core memory
// =============================================================================

memories.post('/:id/promote', async (c) => {
  const userId = c.get('userId');
  if (!userId) {
    return authenticationError(c);
  }

  const id = c.req.param('id');

  try {
    const { promoteToCore } = await import('../services/memory-operations.js');

    await promoteToCore(userId, id);

    return c.json({
      success: true,
      message: 'Memory promoted to core',
      id,
      isCore: true,
    });
  } catch (error: any) {
    if (error.message === 'Memory not found') {
      return notFoundError(c, 'Memory');
    }
    if (error.message.includes('Access denied')) {
      return authorizationError(c);
    }
    return internalError(c, error, 'Memory promote');
  }
});

// =============================================================================
// POST /v1/memories/:id/demote - Demote from core memory
// =============================================================================

memories.post('/:id/demote', async (c) => {
  const userId = c.get('userId');
  if (!userId) {
    return authenticationError(c);
  }

  const id = c.req.param('id');

  try {
    const { demoteFromCore } = await import('../services/memory-operations.js');

    await demoteFromCore(userId, id);

    return c.json({
      success: true,
      message: 'Memory demoted from core',
      id,
      isCore: false,
    });
  } catch (error: any) {
    if (error.message === 'Memory not found') {
      return notFoundError(c, 'Memory');
    }
    if (error.message.includes('Access denied')) {
      return authorizationError(c);
    }
    return internalError(c, error, 'Memory demote');
  }
});

// =============================================================================
// POST /v1/memories/bulk/forget - Batch forget memories
// =============================================================================

memories.post('/bulk/forget', async (c) => {
  const startTime = Date.now();

  const userId = c.get('userId');
  if (!userId) {
    return authenticationError(c);
  }

  const body = await validateBody(c, BatchForgetSchema);
  

  try {
    const { batchForget } = await import('../services/memory-operations.js');

    const result = await batchForget(userId, body.ids);

    return c.json({
      success: true,
      forgotten: result.forgotten.length,
      ids: result.forgotten,
      errors: result.errors.length > 0 ? result.errors : undefined,
      latencyMs: Date.now() - startTime,
    });
  } catch (error) {
    return internalError(c, error, 'Memories batch forget');
  }
});

// =============================================================================
// GET /v1/memories/expiring - Get memories expiring soon
// =============================================================================

memories.get('/expiring', async (c) => {
  const userId = c.get('userId');
  if (!userId) {
    return authenticationError(c);
  }

  const withinHours = parseInt(c.req.query('hours') || '24');
  const limit = parseInt(c.req.query('limit') || '50');

  try {
    const { getConvexClient } = await import('../database/convex.js');
    const convex = getConvexClient();

    const expiring = await convex.query('memoryOps:getExpiringMemories' as any, {
      userId,
      withinHours: Math.min(Math.max(withinHours, 1), 168), // 1 hour to 1 week
      limit: Math.min(limit, 100),
    });

    return c.json({
      memories: expiring,
      count: expiring.length,
      withinHours,
    });
  } catch (error) {
    return internalError(c, error, 'Get expiring memories');
  }
});

// =============================================================================
// GET /v1/memories/by-kind/:kind - Get memories by kind
// =============================================================================

memories.get('/by-kind/:kind', async (c) => {
  const userId = c.get('userId');
  if (!userId) {
    return authenticationError(c);
  }

  const kind = c.req.param('kind');
  if (!['fact', 'preference', 'event'].includes(kind)) {
    return c.json({
      error: 'Invalid memory kind',
      code: 'VALIDATION_ERROR',
      validKinds: ['fact', 'preference', 'event'],
    }, 400);
  }

  const limit = parseInt(c.req.query('limit') || '50');
  const includeExpired = c.req.query('includeExpired') === 'true';

  try {
    const { getConvexClient } = await import('../database/convex.js');
    const convex = getConvexClient();

    const memories = await convex.query('memoryOps:getByKind' as any, {
      userId,
      kind,
      limit: Math.min(limit, 100),
      includeExpired,
    });

    const results = (memories as any[]).map((m: any) => ({
      id: m._id,
      content: m.content,
      kind: m.memory_kind,
      isCore: m.is_core,
      expiresAt: m.expires_at ? new Date(m.expires_at).toISOString() : null,
      createdAt: new Date(m.created_at).toISOString(),
    }));

    return c.json({
      kind,
      memories: results,
      count: results.length,
    });
  } catch (error) {
    return internalError(c, error, 'Get memories by kind');
  }
});

// =============================================================================
// GET /v1/memories/expiry-stats - Get expiration statistics
// =============================================================================

memories.get('/expiry-stats', async (c) => {
  const userId = c.get('userId');
  if (!userId) {
    return authenticationError(c);
  }

  try {
    const { getConvexClient } = await import('../database/convex.js');
    const convex = getConvexClient();

    const stats = await convex.query('memoryOps:getExpiryStats' as any, {
      userId,
    });

    return c.json({ stats });
  } catch (error) {
    return internalError(c, error, 'Get expiry stats');
  }
});

// =============================================================================
// POST /v1/memories/:id/set-expiry - Set memory expiration
// =============================================================================

memories.post('/:id/set-expiry', async (c) => {
  const userId = c.get('userId');
  if (!userId) {
    return authenticationError(c);
  }

  const id = c.req.param('id');
  let body: { expiresAt?: string | number | null; expiresIn?: string };

  try {
    body = await c.req.json();
  } catch {
    return c.json({
      error: 'Invalid JSON body',
      code: 'VALIDATION_ERROR',
    }, 400);
  }

  // Parse expiration: can be ISO string, unix timestamp, relative string, or null
  let expiresAt: number | undefined;

  if (body.expiresAt === null) {
    // Remove expiration
    expiresAt = undefined;
  } else if (body.expiresAt) {
    if (typeof body.expiresAt === 'number') {
      expiresAt = body.expiresAt;
    } else if (typeof body.expiresAt === 'string') {
      const parsed = Date.parse(body.expiresAt);
      if (!isNaN(parsed)) {
        expiresAt = parsed;
      } else {
        return c.json({
          error: 'Invalid expiresAt format. Use ISO date string or unix timestamp.',
          code: 'VALIDATION_ERROR',
        }, 400);
      }
    }
  } else if (body.expiresIn) {
    // Parse relative time like "1d", "2h", "1w"
    const match = body.expiresIn.match(/^(\d+)([hdwm])$/i);
    if (match) {
      const num = parseInt(match[1]);
      const unit = match[2].toLowerCase();
      const now = Date.now();
      const multipliers: Record<string, number> = {
        h: 60 * 60 * 1000,           // hours
        d: 24 * 60 * 60 * 1000,      // days
        w: 7 * 24 * 60 * 60 * 1000,  // weeks
        m: 30 * 24 * 60 * 60 * 1000, // months (approx)
      };
      expiresAt = now + (num * multipliers[unit]);
    } else {
      return c.json({
        error: 'Invalid expiresIn format. Use "1h", "2d", "1w", or "1m".',
        code: 'VALIDATION_ERROR',
      }, 400);
    }
  }

  try {
    const { getConvexClient } = await import('../database/convex.js');
    const convex = getConvexClient();

    const result = await convex.mutation('memoryOps:setExpiration' as any, {
      id,
      userId,
      expiresAt,
    });

    return c.json({
      success: true,
      id,
      expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
    });
  } catch (error: any) {
    if (error.message === 'Memory not found') {
      return notFoundError(c, 'Memory');
    }
    if (error.message.includes('Access denied')) {
      return authorizationError(c);
    }
    return internalError(c, error, 'Set memory expiry');
  }
});

export default memories;
