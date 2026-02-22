/**
 * Entity Graph Routes for Aethene API
 * /v1/entities - Entity and relationship graph queries
 *
 * Provides Supermemory-compatible semantic graph features:
 * - Entity listing and search
 * - Relationship queries
 * - Graph visualization data
 */

import { Hono } from 'hono';
import type { AppEnv } from '../types/hono.js';
import {
  authenticationError,
  notFoundError,
  internalError,
  validateBody,
} from '../utils/errors.js';
import { z } from 'zod';

const entities = new Hono<AppEnv>();

// =============================================================================
// GET /v1/entities - List all entities for user
// =============================================================================

entities.get('/', async (c) => {
  const userId = c.get('userId');
  if (!userId) {
    return authenticationError(c);
  }

  const entityType = c.req.query('type');
  const limit = parseInt(c.req.query('limit') || '50');

  try {
    const { getConvexClient } = await import('../database/convex.js');
    const convex = getConvexClient();

    const result = await convex.query('entities:getByUser' as any, {
      userId,
      entityType: entityType || undefined,
      limit: Math.min(limit, 200),
    });

    return c.json({
      entities: (result as any[]).map((e: any) => ({
        id: e._id,
        name: e.name,
        type: e.entity_type,
        mentionCount: e.mention_count,
        createdAt: new Date(e.created_at).toISOString(),
        updatedAt: new Date(e.updated_at).toISOString(),
      })),
      count: (result as any[]).length,
    });
  } catch (error) {
    return internalError(c, error, 'List entities');
  }
});

// =============================================================================
// GET /v1/entities/search - Search entities by name
// =============================================================================

entities.get('/search', async (c) => {
  const userId = c.get('userId');
  if (!userId) {
    return authenticationError(c);
  }

  const query = c.req.query('q');
  if (!query) {
    return c.json({ error: 'Missing query parameter q' }, 400);
  }

  const limit = parseInt(c.req.query('limit') || '20');

  try {
    const { getConvexClient } = await import('../database/convex.js');
    const convex = getConvexClient();

    const result = await convex.query('entities:searchByName' as any, {
      userId,
      query,
      limit: Math.min(limit, 100),
    });

    return c.json({
      entities: (result as any[]).map((e: any) => ({
        id: e._id,
        name: e.name,
        type: e.entity_type,
        mentionCount: e.mention_count,
      })),
      count: (result as any[]).length,
      query,
    });
  } catch (error) {
    return internalError(c, error, 'Search entities');
  }
});

// =============================================================================
// GET /v1/entities/graph - Get full entity graph for visualization
// =============================================================================

entities.get('/graph', async (c) => {
  const userId = c.get('userId');
  if (!userId) {
    return authenticationError(c);
  }

  const limit = parseInt(c.req.query('limit') || '100');

  try {
    const { getConvexClient } = await import('../database/convex.js');
    const convex = getConvexClient();

    const result = await convex.query('entities:getGraph' as any, {
      userId,
      limit: Math.min(limit, 500),
    });

    return c.json(result);
  } catch (error) {
    return internalError(c, error, 'Get entity graph');
  }
});

// =============================================================================
// GET /v1/entities/stats - Get entity statistics
// =============================================================================

entities.get('/stats', async (c) => {
  const userId = c.get('userId');
  if (!userId) {
    return authenticationError(c);
  }

  try {
    const { getConvexClient } = await import('../database/convex.js');
    const convex = getConvexClient();

    const result = await convex.query('entities:getStats' as any, {
      userId,
    });

    return c.json(result);
  } catch (error) {
    return internalError(c, error, 'Get entity stats');
  }
});

// =============================================================================
// GET /v1/entities/:id - Get specific entity with relationships
// =============================================================================

entities.get('/:id', async (c) => {
  const userId = c.get('userId');
  if (!userId) {
    return authenticationError(c);
  }

  const id = c.req.param('id');

  try {
    const { getConvexClient } = await import('../database/convex.js');
    const convex = getConvexClient();

    const entity = await convex.query('entities:getById' as any, { id });

    if (!entity) {
      return notFoundError(c, 'Entity');
    }

    // Get relationships
    const relationships = await convex.query('entities:getRelationships' as any, {
      entityId: id,
      direction: 'both',
    });

    // Get memories mentioning this entity
    const memories = await convex.query('entities:getMemoriesForEntity' as any, {
      entityId: id,
      limit: 20,
    });

    const e = entity as any;
    return c.json({
      id: e._id,
      name: e.name,
      type: e.entity_type,
      mentionCount: e.mention_count,
      createdAt: new Date(e.created_at).toISOString(),
      updatedAt: new Date(e.updated_at).toISOString(),
      relationships: (relationships as any[]).map((r: any) => ({
        id: r._id,
        direction: r.direction,
        relationship: r.relationship,
        confidence: r.confidence,
        relatedEntity: r.relatedEntity ? {
          id: r.relatedEntity._id,
          name: r.relatedEntity.name,
          type: r.relatedEntity.entity_type,
        } : null,
      })),
      memories: (memories as any[]).map((m: any) => ({
        id: m._id,
        content: m.content,
        role: m.role,
        isCore: m.is_core,
        createdAt: new Date(m.created_at).toISOString(),
      })),
    });
  } catch (error) {
    return internalError(c, error, 'Get entity');
  }
});

// =============================================================================
// POST /v1/entities/build - Manually trigger graph building for existing memories
// =============================================================================

const BuildGraphSchema = z.object({
  memoryIds: z.array(z.string()).optional(),
  rebuildAll: z.boolean().optional(),
  limit: z.number().min(1).max(100).optional(), // Limit for rebuildAll to prevent timeout
  async: z.boolean().optional(), // Run in background
});

entities.post('/build', async (c) => {
  const userId = c.get('userId');
  if (!userId) {
    return authenticationError(c);
  }

  const body = await validateBody(c, BuildGraphSchema);

  try {
    const { getConvexClient } = await import('../database/convex.js');
    const { buildGraphForMemories } = await import('../services/graph-builder.js');
    const convex = getConvexClient();

    let memories: Array<{ id: string; content: string }>;

    if (body.memoryIds && body.memoryIds.length > 0) {
      // Build for specific memories
      const results = await Promise.all(
        body.memoryIds.map(async (id) => {
          const mem = await convex.query('memories:getById' as any, { id });
          return mem ? { id: (mem as any)._id, content: (mem as any).content } : null;
        })
      );
      memories = results.filter((m): m is { id: string; content: string } => m !== null);
    } else if (body.rebuildAll) {
      // Get memories for user with limit to prevent timeout
      const limit = body.limit || 50; // Default to 50 to prevent timeout
      const allMemories = await convex.query('memories:getByUser' as any, {
        userId,
        limit,
      });
      memories = (allMemories as any[]).map((m: any) => ({
        id: m._id,
        content: m.content,
      }));
    } else {
      return c.json({ error: 'Must provide memoryIds or set rebuildAll: true' }, 400);
    }

    // If async mode, process in background and return immediately
    if (body.async) {
      const jobId = `build-${Date.now()}`;

      // Process in background (fire and forget)
      buildGraphForMemories(memories, userId)
        .then(result => {
          console.log(`[EntityGraph] Job ${jobId} complete: ${result.totalEntities} entities, ${result.totalRelationships} relationships`);
        })
        .catch(err => {
          console.error(`[EntityGraph] Job ${jobId} failed:`, err);
        });

      return c.json({
        success: true,
        async: true,
        jobId,
        memoriesQueued: memories.length,
        message: 'Graph building started in background',
      }, 202);
    }

    // Sync mode - wait for completion
    const result = await buildGraphForMemories(memories, userId);

    return c.json({
      success: true,
      memoriesProcessed: memories.length,
      entitiesCreated: result.totalEntities,
      relationshipsCreated: result.totalRelationships,
    });
  } catch (error) {
    return internalError(c, error, 'Build entity graph');
  }
});

// =============================================================================
// POST /v1/entities/:id/query - Query entity relationships (graph traversal)
// =============================================================================

const QuerySchema = z.object({
  query: z.string(),
  maxDepth: z.number().min(1).max(5).optional(),
});

entities.post('/:id/query', async (c) => {
  const userId = c.get('userId');
  if (!userId) {
    return authenticationError(c);
  }

  const id = c.req.param('id');
  const body = await validateBody(c, QuerySchema);

  try {
    const { getConvexClient } = await import('../database/convex.js');
    const convex = getConvexClient();

    // Get entity
    const entity = await convex.query('entities:getById' as any, { id });
    if (!entity) {
      return notFoundError(c, 'Entity');
    }

    // Get relationships
    const relationships = await convex.query('entities:getRelationships' as any, {
      entityId: id,
      direction: 'both',
    });

    // Get memories
    const memories = await convex.query('entities:getMemoriesForEntity' as any, {
      entityId: id,
      limit: 50,
    });

    // Build context for answering the query
    const e = entity as any;
    const context = [
      `Entity: ${e.name} (${e.entity_type})`,
      '',
      'Relationships:',
      ...(relationships as any[]).map((r: any) => {
        const related = r.relatedEntity;
        if (r.direction === 'outgoing') {
          return `- ${e.name} ${r.relationship} ${related?.name || 'unknown'}`;
        } else {
          return `- ${related?.name || 'unknown'} ${r.relationship} ${e.name}`;
        }
      }),
      '',
      'Related memories:',
      ...(memories as any[]).map((m: any) => `- ${m.content}`),
    ].join('\n');

    // Use LLM to answer the query
    const { GoogleGenerativeAI } = await import('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

    const result = await model.generateContent([
      { text: `Based on the following information about ${e.name}, answer this question: ${body.query}\n\nContext:\n${context}\n\nAnswer concisely:` },
    ]);

    return c.json({
      entity: {
        id: e._id,
        name: e.name,
        type: e.entity_type,
      },
      query: body.query,
      answer: result.response.text().trim(),
      context: {
        relationshipCount: (relationships as any[]).length,
        memoryCount: (memories as any[]).length,
      },
    });
  } catch (error) {
    return internalError(c, error, 'Query entity');
  }
});

export default entities;
