/**
 * Memory Relations Routes for Aethene API
 * Supermemory-compatible memory relationship endpoints
 *
 * GET /v1/memories/:id/relations - Get memory relationships
 * GET /v1/relations - Get all relationships for user
 * POST /v1/relations/infer - Trigger inference of new relationships
 * POST /v1/relations/contradictions - Find contradicting memories
 * POST /v1/memories/:id/supersede - Mark memory as superseding another
 */

import { Hono } from 'hono';
import type { AppEnv } from '../types/hono.js';
import { z } from 'zod';
import {
  authenticationError,
  notFoundError,
  internalError,
  validationError,
} from '../utils/errors.js';

const relations = new Hono<AppEnv>();

// =============================================================================
// SCHEMAS
// =============================================================================

const SupersedeSchema = z.object({
  supersededMemoryId: z.string().min(1),
  confidence: z.number().min(0).max(1).optional().default(1.0),
});

// =============================================================================
// GET /v1/memories/:id/relations - Get relationships for a specific memory
// =============================================================================

relations.get('/memories/:id/relations', async (c) => {
  const startTime = Date.now();

  const userId = c.get('userId');
  if (!userId) {
    return authenticationError(c);
  }

  const memoryId = c.req.param('id');

  try {
    const { MemoryRelationsService } = await import('../services/memory-relations.js');

    const result = await MemoryRelationsService.getMemoryWithRelationships(memoryId as any);

    if (!result) {
      return notFoundError(c, 'Memory');
    }

    // Format response in Supermemory style
    return c.json({
      memory: {
        id: result.id,
        content: result.content,
        isLatest: result.isLatest,
        version: result.version,
      },
      relationships: result.relationships.map(r => ({
        id: r.id,
        type: r.relationType,  // UPDATES, EXTENDS, DERIVES
        aetheneType: r.aetheneType,  // supersedes, enriches, inferred
        direction: r.direction,
        relatedMemoryId: r.relatedMemoryId,
        relatedContent: r.relatedContent,
        confidence: r.confidence,
        createdAt: new Date(r.createdAt).toISOString(),
      })),
      supersededBy: result.supersededBy || null,
      extends: result.extends || [],
      derivedFrom: result.derivedFrom || [],
      timing: Date.now() - startTime,
    });
  } catch (error) {
    return internalError(c, error, 'Get memory relations');
  }
});

// =============================================================================
// GET /v1/relations - Get all relationships for user
// =============================================================================

relations.get('/relations', async (c) => {
  const startTime = Date.now();

  const userId = c.get('userId');
  if (!userId) {
    return authenticationError(c);
  }

  try {
    const { MemoryRelationsService } = await import('../services/memory-relations.js');

    const result = await MemoryRelationsService.getAllRelationships(userId);

    return c.json({
      relationships: result.relationships.map(r => ({
        id: r.id,
        fromMemoryId: r.memoryId,
        toMemoryId: r.relatedMemoryId,
        type: r.relationType,  // UPDATES, EXTENDS, DERIVES
        aetheneType: r.aetheneType,
        confidence: r.confidence,
        createdAt: new Date(r.createdAt).toISOString(),
      })),
      summary: {
        total: result.relationships.length,
        byType: result.byType,
      },
      timing: Date.now() - startTime,
    });
  } catch (error) {
    return internalError(c, error, 'Get all relations');
  }
});

// =============================================================================
// GET /v1/relations/graph - Get memory graph for visualization
// =============================================================================

relations.get('/relations/graph', async (c) => {
  const startTime = Date.now();

  const userId = c.get('userId');
  if (!userId) {
    return authenticationError(c);
  }

  try {
    const { MemoryRelationsService, REVERSE_LINK_TYPE_MAP } = await import('../services/memory-relations.js');

    const graph = await MemoryRelationsService.getMemoryGraph(userId);

    // Convert to Supermemory-compatible format
    return c.json({
      nodes: graph.nodes.map(n => ({
        id: n.id,
        label: n.content,
        kind: n.kind,
        isCore: n.isCore,
      })),
      edges: graph.edges.map(e => ({
        source: e.from,
        target: e.to,
        type: REVERSE_LINK_TYPE_MAP[e.type as keyof typeof REVERSE_LINK_TYPE_MAP] || e.type,
        aetheneType: e.type,
        confidence: e.confidence,
      })),
      timing: Date.now() - startTime,
    });
  } catch (error) {
    return internalError(c, error, 'Get relations graph');
  }
});

// =============================================================================
// POST /v1/relations/infer - Trigger inference of new relationships
// =============================================================================

relations.post('/relations/infer', async (c) => {
  const startTime = Date.now();

  const userId = c.get('userId');
  if (!userId) {
    return authenticationError(c);
  }

  try {
    const { MemoryRelationsService } = await import('../services/memory-relations.js');

    const result = await MemoryRelationsService.inferRelationships(userId);

    return c.json({
      success: true,
      inferred: result.inferred,
      patterns: result.patterns,
      timing: Date.now() - startTime,
    });
  } catch (error) {
    return internalError(c, error, 'Infer relations');
  }
});

// =============================================================================
// POST /v1/relations/contradictions - Find contradicting memories
// =============================================================================

relations.post('/relations/contradictions', async (c) => {
  const startTime = Date.now();

  const userId = c.get('userId');
  if (!userId) {
    return authenticationError(c);
  }

  try {
    const { MemoryRelationsService } = await import('../services/memory-relations.js');

    const contradictions = await MemoryRelationsService.findContradictions(userId);

    return c.json({
      contradictions: contradictions.map(c => ({
        memory1: c.memory1,
        memory2: c.memory2,
        confidence: c.confidence,
        reason: c.reason,
        suggestedAction: 'Mark newer memory as superseding older one',
      })),
      count: contradictions.length,
      timing: Date.now() - startTime,
    });
  } catch (error) {
    return internalError(c, error, 'Find contradictions');
  }
});

// =============================================================================
// POST /v1/memories/:id/supersede - Mark memory as superseding another
// =============================================================================

relations.post('/memories/:id/supersede', async (c) => {
  const startTime = Date.now();

  const userId = c.get('userId');
  if (!userId) {
    return authenticationError(c);
  }

  const newMemoryId = c.req.param('id');

  let body: z.infer<typeof SupersedeSchema>;
  try {
    const raw = await c.req.json();
    body = SupersedeSchema.parse(raw);
  } catch (error: any) {
    return validationError(c, error.message || 'Invalid request body');
  }

  try {
    const { MemoryRelationsService } = await import('../services/memory-relations.js');

    const success = await MemoryRelationsService.markAsSuperseded(
      newMemoryId as any,
      body.supersededMemoryId as any,
      body.confidence
    );

    if (!success) {
      return c.json({
        success: false,
        error: 'Failed to create supersede relationship',
      }, 400);
    }

    return c.json({
      success: true,
      relationship: {
        type: 'UPDATES',
        fromMemoryId: newMemoryId,
        toMemoryId: body.supersededMemoryId,
        confidence: body.confidence,
      },
      timing: Date.now() - startTime,
    });
  } catch (error) {
    return internalError(c, error, 'Mark supersede');
  }
});

export default relations;
