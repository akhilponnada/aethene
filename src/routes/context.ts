/**
 * Context Routes for Aethene API
 * POST /v1/context - Get memory context for LLM system prompts
 *
 * Returns core memories and optional relevant context
 * formatted for injection into LLM system prompts.
 */

import { Hono } from 'hono';
import type { AppEnv } from '../types/hono.js';
import { ContextSchema } from '../types/schemas.js';
import {
  authenticationError,
  internalError,
  validateBody,
} from '../utils/errors.js';

const context = new Hono<AppEnv>();

// =============================================================================
// POST /v1/context - Get memory context
// =============================================================================

context.post('/', async (c) => {
  const startTime = Date.now();

  const userId = c.get('userId');
  if (!userId) {
    return authenticationError(c);
  }

  // Parse body, allow empty body
  let body: { query?: string; includeRecent?: boolean; limit?: number };
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }

  // Validate with defaults
  const validated = {
    query: body.query || undefined,
    includeRecent: body.includeRecent !== false,
    limit: body.limit || 20,
  };

  try {
    const { ContextBuilder } = await import('../services/context-builder.js');

    const result = await ContextBuilder.getProfile(userId, {
      q: validated.query,
      includeRecent: validated.includeRecent,
    });

    // Build context object
    const core = result.profile.static;
    const recent = result.profile.dynamic;

    // Format for LLM if requested
    const formatted = ContextBuilder.formatContextForPrompt(result);

    return c.json({
      context: {
        core,
        recent,
      },
      relevant: result.searchResults || null,
      formatted,
      latencyMs: Date.now() - startTime,
    });
  } catch (error) {
    return internalError(c, error, 'Context');
  }
});

// =============================================================================
// GET /v1/context/formatted - Get pre-formatted context string
// =============================================================================

context.get('/formatted', async (c) => {
  const startTime = Date.now();

  const userId = c.get('userId');
  if (!userId) {
    return authenticationError(c);
  }

  const query = c.req.query('q');

  try {
    const { ContextBuilder } = await import('../services/context-builder.js');

    const result = await ContextBuilder.getProfile(userId, {
      q: query,
      includeRecent: true,
    });

    const formatted = ContextBuilder.formatContextForPrompt(result);

    return c.json({
      context: formatted,
      memoryCount: result.profile.static.length + result.profile.dynamic.length,
      latencyMs: Date.now() - startTime,
    });
  } catch (error) {
    return internalError(c, error, 'Context formatted');
  }
});

export default context;
