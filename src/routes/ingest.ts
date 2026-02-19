/**
 * Ingest Routes for Aethene API
 * POST /v1/ingest - Legacy ingest endpoint
 *
 * DEPRECATED: Use /v1/content instead.
 * This endpoint is maintained for backwards compatibility.
 */

import { Hono } from 'hono';
import type { AppEnv } from '../types/hono.js';
import { IngestContentSchema } from '../types/schemas.js';
import {
  authenticationError,
  internalError,
  validateBody,
} from '../utils/errors.js';

const ingest = new Hono<AppEnv>();

// =============================================================================
// POST /v1/ingest - Ingest content (legacy)
// =============================================================================

ingest.post('/', async (c) => {
  const startTime = Date.now();

  const userId = c.get('userId');
  if (!userId) {
    return authenticationError(c);
  }

  const body = await validateBody(c, IngestContentSchema);
  

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
      workflowInstanceId: result.workflowInstanceId,
      message: `Content queued for processing`,
      latencyMs: Date.now() - startTime,
      deprecated: true,
      migrateToUrl: '/v1/content',
    }, 202);
  } catch (error) {
    return internalError(c, error, 'Ingest');
  }
});

export default ingest;
