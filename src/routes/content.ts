/**
 * Content Routes for Aethene API
 * /v1/content - Ingest content with async extraction
 *
 * Content = documents that get processed into memories
 * - Queue content for async processing
 * - Auto-extract memories (static/dynamic)
 * - Auto-generate title and summary
 * - Chunk long content for better retrieval
 */

import { Hono } from 'hono';
import type { AppEnv } from '../types/hono.js';
import {
  IngestContentSchema,
  UpdateContentSchema,
  BulkDeleteSchema,
  ListContentQuerySchema,
} from '../types/schemas.js';
import {
  authenticationError,
  authorizationError,
  notFoundError,
  internalError,
  validateBody,
  validateQuery,
} from '../utils/errors.js';

const content = new Hono<AppEnv>();

// =============================================================================
// POST /v1/content - Ingest content (async extraction)
// =============================================================================

content.post('/', async (c) => {
  const startTime = Date.now();

  const authUserId = c.get('userId');
  if (!authUserId) {
    return authenticationError(c);
  }

  // validateBody throws ValidationError if validation fails (caught by global handler)
  const body = await validateBody(c, IngestContentSchema);

  // Use containerTag or userId from body (like Supermemory), fallback to auth userId
  const userId = body.containerTag || body.userId || authUserId;

  try {
    const { IngestService } = await import('../services/ingest-service.js');

    // Map contentType to service-compatible format
    const serviceContentType = body.contentType === 'html' || body.contentType === 'markdown'
      ? 'text'
      : body.contentType;

    const result = await IngestService.ingestContent(userId, body.content, {
      customId: body.customId,
      contentType: serviceContentType as 'text' | 'url' | 'file',
      metadata: body.metadata,
    });

    return c.json({
      id: result.id,
      status: result.status,
      workflowId: result.workflowInstanceId,
      async: body.async,
      latencyMs: Date.now() - startTime,
    }, 202);
  } catch (error) {
    return internalError(c, error, 'Content ingest');
  }
});

// =============================================================================
// GET /v1/content - List user's content
// =============================================================================

content.get('/', async (c) => {
  const userId = c.get('userId');
  if (!userId) {
    return authenticationError(c);
  }

  const query = validateQuery(c, ListContentQuerySchema);

  try {
    const { IngestService } = await import('../services/ingest-service.js');

    const result = await IngestService.listDocuments(userId, {
      limit: query.limit,
      page: Math.floor(query.offset / query.limit) + 1,
    });

    // Transform to Aethene format
    const documents = result.memories.map((doc) => ({
      id: doc.id,
      customId: doc.customId,
      title: doc.title,
      summary: doc.summary,
      type: doc.type,
      status: doc.status,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
      metadata: doc.metadata,
    }));

    return c.json({
      documents,
      count: documents.length,
      pagination: {
        offset: query.offset,
        limit: query.limit,
        total: result.pagination.totalItems,
        hasMore: result.pagination.currentPage < result.pagination.totalPages,
      },
    });
  } catch (error) {
    return internalError(c, error, 'Content list');
  }
});

// =============================================================================
// GET /v1/content/queue - Get processing queue status
// =============================================================================

content.get('/queue', async (c) => {
  const userId = c.get('userId');
  if (!userId) {
    return authenticationError(c);
  }

  try {
    const { getConvexClient } = await import('../database/convex.js');
    const convex = getConvexClient();

    // Count documents by status
    const statuses = ['queued', 'extracting', 'chunking', 'embedding', 'indexing'];
    const counts: Record<string, number> = {};

    for (const status of statuses) {
      try {
        const docs = await convex.query('content:listByStatus' as any, {
          user_id: userId,
          status,
          limit: 100,
        });
        counts[status] = (docs as any[] || []).length;
      } catch {
        counts[status] = 0;
      }
    }

    const processing = Object.values(counts).reduce((a, b) => a + b, 0);

    return c.json({
      processing,
      breakdown: counts,
      status: processing > 0 ? 'processing' : 'idle',
    });
  } catch (error) {
    return internalError(c, error, 'Queue status');
  }
});

// =============================================================================
// GET /v1/content/:id - Get specific content with status
// =============================================================================

content.get('/:id', async (c) => {
  const userId = c.get('userId');
  if (!userId) {
    return authenticationError(c);
  }

  const id = c.req.param('id');

  try {
    const { IngestService } = await import('../services/ingest-service.js');

    const document = await IngestService.getDocument(userId, id);

    if (!document) {
      return notFoundError(c, 'Content');
    }

    return c.json({
      id: document.id,
      customId: document.customId,
      title: document.title,
      summary: document.summary,
      type: document.type,
      status: document.status,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
      metadata: document.metadata,
    });
  } catch (error) {
    return internalError(c, error, 'Content get');
  }
});

// =============================================================================
// PATCH /v1/content/:id - Update content (re-queues for processing)
// =============================================================================

content.patch('/:id', async (c) => {
  const startTime = Date.now();

  const userId = c.get('userId');
  if (!userId) {
    return authenticationError(c);
  }

  const id = c.req.param('id');
  const body = await validateBody(c, UpdateContentSchema);

  try {
    const { IngestService } = await import('../services/ingest-service.js');

    // Verify document exists
    const existing = await IngestService.getDocument(userId, id);
    if (!existing) {
      return notFoundError(c, 'Content');
    }

    if (body.content) {
      // Re-ingest with new content
      const result = await IngestService.updateDocument(userId, id, body.content, body.metadata);

      return c.json({
        id: result.id,
        status: result.status,
        workflowId: result.workflowInstanceId,
        latencyMs: Date.now() - startTime,
      });
    } else {
      // Just update metadata
      const { getConvexClient } = await import('../database/convex.js');
      const convex = getConvexClient();

      await convex.mutation('content:update' as any, {
        user_id: userId,
        document_id: id,
        title: body.title,
        metadata: body.metadata,
        updated_at: Date.now(),
      });

      return c.json({
        success: true,
        id,
        latencyMs: Date.now() - startTime,
      });
    }
  } catch (error) {
    return internalError(c, error, 'Content update');
  }
});

// =============================================================================
// DELETE /v1/content/:id - Delete content
// =============================================================================

content.delete('/:id', async (c) => {
  const userId = c.get('userId');
  if (!userId) {
    return authenticationError(c);
  }

  const id = c.req.param('id');

  try {
    const { IngestService } = await import('../services/ingest-service.js');

    // Verify exists
    const existing = await IngestService.getDocument(userId, id);
    if (!existing) {
      return notFoundError(c, 'Content');
    }

    const success = await IngestService.deleteDocument(userId, id);

    return c.json({
      success,
      message: success ? 'Content deleted' : 'Deletion failed',
      id,
    });
  } catch (error) {
    return internalError(c, error, 'Content delete');
  }
});

// =============================================================================
// DELETE /v1/content/bulk - Bulk delete content
// =============================================================================

content.delete('/bulk', async (c) => {
  const startTime = Date.now();

  const userId = c.get('userId');
  if (!userId) {
    return authenticationError(c);
  }

  const body = await validateBody(c, BulkDeleteSchema);

  try {
    const { IngestService } = await import('../services/ingest-service.js');

    const result = await IngestService.bulkDeleteDocuments(userId, { ids: body.ids });

    return c.json({
      success: true,
      deleted: result.deleted,
      requested: body.ids.length,
      latencyMs: Date.now() - startTime,
    });
  } catch (error) {
    return internalError(c, error, 'Content bulk delete');
  }
});

export default content;
