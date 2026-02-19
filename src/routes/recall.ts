/**
 * Recall Routes for Aethene API
 * POST /v1/recall - Legacy hybrid search endpoint
 *
 * This is maintained for backwards compatibility.
 * New clients should use /v1/search or /v1/search/recall
 */

import { Hono } from 'hono';
import type { AppEnv } from '../types/hono.js';
import { RecallSchema } from '../types/schemas.js';
import {
  authenticationError,
  internalError,
  validateBody,
} from '../utils/errors.js';

const recall = new Hono<AppEnv>();

// =============================================================================
// POST /v1/recall - Hybrid search (legacy endpoint)
// =============================================================================

recall.post('/', async (c) => {
  const startTime = Date.now();

  const userId = c.get('userId');
  if (!userId) {
    return authenticationError(c);
  }

  const body = await validateBody(c, RecallSchema);
  

  try {
    const { RecallService } = await import('../services/recall-service.js');
    const { ContextBuilder } = await import('../services/context-builder.js');

    // Run search and profile retrieval in parallel
    const [searchResponse, profile] = await Promise.all([
      RecallService.searchMemories(userId, body.query, {
        limit: body.limit,
        searchMode: 'hybrid',
        rerank: body.rerank,
        threshold: body.threshold,
      }),
      body.includeProfile ? ContextBuilder.getProfile(userId) : null,
    ]);

    // Format results
    const results = searchResponse.results.map((r) => ({
      id: r.id,
      content: body.includeContent ? r.memory : r.memory.substring(0, 200),
      relevance: r.similarity,
      type: (r as any).isFromChunk ? 'document_chunk' : (r as any).isCore ? 'core_memory' : 'memory',
      timestamp: r.updatedAt,
      documentId: r.documents?.[0]?.id,
    }));

    return c.json({
      results,
      count: results.length,
      profile: profile ? {
        static: profile.profile.static,
        dynamic: profile.profile.dynamic,
      } : null,
      latencyMs: Date.now() - startTime,
    });
  } catch (error) {
    return internalError(c, error, 'Recall');
  }
});

export default recall;
