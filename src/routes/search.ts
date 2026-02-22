/**
 * Search Routes for Aethene API
 * /v1/search - Search memories and documents
 * /v1/recall - Search with context assembly
 *
 * Search modes:
 * - memories: Search only extracted memories
 * - documents: Search only document chunks
 * - hybrid: Search both and merge results (default)
 */

import { Hono } from 'hono';
import type { AppEnv } from '../types/hono.js';
import { SearchSchema, RecallSchema } from '../types/schemas.js';
import {
  authenticationError,
  internalError,
  validateBody,
} from '../utils/errors.js';
import { resolveUserId } from '../middleware/auth.js';

const search = new Hono<AppEnv>();

// =============================================================================
// POST /v1/search - Search memories and documents
// =============================================================================

search.post('/', async (c) => {
  const startTime = Date.now();

  const authUserId = c.get('userId');
  if (!authUserId) {
    return authenticationError(c);
  }

  const body = await validateBody(c, SearchSchema);

  // SECURITY: Validate userId override to prevent IDOR attacks
  const requestedUserId = body.containerTag || body.userId;
  const userId = resolveUserId(c, requestedUserId);
  const containerTag = body.containerTag;

  try {
    const { RecallService } = await import('../services/recall-service.js');

    // Determine search function based on mode
    let results: any[];
    let total: number;

    if (body.mode === 'documents') {
      const response = await RecallService.searchDocuments(userId, body.query, {
        limit: body.limit,
        filters: body.filters,
      });
      results = response.results.map((r) => ({
        id: r.documentId,
        content: r.chunks.map((ch) => ch.content).join('\n'),
        title: r.title,
        type: 'document',
        score: r.score,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        chunks: r.chunks,
        metadata: r.metadata,
      }));
      total = response.total;
    } else {
      // memories or hybrid mode
      const searchMode = body.mode === 'memories' ? 'memories' : 'hybrid';

      // Extract legacy categories for backwards compatibility
      const legacyCategories = body.filters && 'categories' in body.filters
        ? (body.filters as { categories?: string[] }).categories
        : undefined;

      const response = await RecallService.searchMemories(userId, body.query, {
        limit: body.limit,
        searchMode,
        rerank: body.rerank,
        threshold: body.threshold,
        categories: legacyCategories,
        // Pass full filters object for advanced Supermemory-compatible filtering
        filters: body.filters && ('AND' in body.filters || 'OR' in body.filters)
          ? body.filters as any
          : undefined,
        // Version handling: by default only latest versions, set true to include old versions
        includeHistory: body.includeHistory,
        // Container tag for filtering results
        containerTag,
      });
      results = response.results.map((r) => ({
        id: r.id,
        content: r.memory,
        type: 'memory',
        score: r.similarity,
        version: r.version,
        isLatest: r.isLatest,  // Indicates if this is the current version
        updatedAt: r.updatedAt,
        metadata: r.metadata,
        rootMemoryId: r.rootMemoryId,
      }));
      total = response.total;
    }

    return c.json({
      results,
      total,
      query: body.query,
      mode: body.mode,
      latencyMs: Date.now() - startTime,
    });
  } catch (error) {
    return internalError(c, error, 'Search');
  }
});

// =============================================================================
// POST /v1/recall - Search with context assembly
// =============================================================================

search.post('/recall', async (c) => {
  const startTime = Date.now();

  const authUserId = c.get('userId');
  if (!authUserId) {
    return authenticationError(c);
  }

  const body = await validateBody(c, RecallSchema);

  // Always use authUserId for recall, containerTag is for filtering
  const userId = authUserId;
  const containerTag = body.containerTag;

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
        containerTag,
      }),
      body.includeProfile ? ContextBuilder.getProfile(userId, { containerTag }) : null,
    ]);

    // Build context
    const context: string[] = [];

    // Add profile context if available
    if (profile) {
      if (profile.profile.static.length > 0) {
        context.push('## User Profile');
        context.push(...profile.profile.static);
      }
      if (profile.profile.dynamic.length > 0) {
        context.push('## User Context');
        context.push(...profile.profile.dynamic);
      }
    }

    // Add search results as context
    if (searchResponse.results.length > 0) {
      context.push('## Relevant Memories');
      for (const r of searchResponse.results) {
        context.push(`- ${r.memory}`);
      }
    }

    // Format results
    const results = searchResponse.results.map((r) => ({
      id: r.id,
      content: r.memory,
      score: r.similarity,
      version: r.version,
      updatedAt: r.updatedAt,
      rootMemoryId: r.rootMemoryId,
    }));

    return c.json({
      results,
      total: searchResponse.total,
      context: context.join('\n'),
      profile: profile ? {
        static: profile.profile.static,
        dynamic: profile.profile.dynamic,
      } : null,
      query: body.query,
      latencyMs: Date.now() - startTime,
    });
  } catch (error) {
    return internalError(c, error, 'Recall');
  }
});

export default search;
