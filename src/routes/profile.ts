/**
 * Profile Routes for Aethene API
 * /v1/profile - User profile and context
 *
 * Profile structure:
 * - static: Named entity facts (permanent, like "Sarah Johnson is 28 years old")
 * - dynamic: User-prefixed facts (contextual, like "User prefers dark mode")
 */

import { Hono } from 'hono';
import type { AppEnv } from '../types/hono.js';
import { ProfileQuerySchema, ProfileSearchSchema } from '../types/schemas.js';
import {
  authenticationError,
  internalError,
  validateBody,
  validateQuery,
} from '../utils/errors.js';
import { resolveUserId } from '../middleware/auth.js';

const profile = new Hono<AppEnv>();

// =============================================================================
// GET /v1/profile - Get user profile (static + dynamic)
// =============================================================================

profile.get('/', async (c) => {
  const startTime = Date.now();

  const authUserId = c.get('userId');
  if (!authUserId) {
    return authenticationError(c);
  }

  const query = validateQuery(c, ProfileQuerySchema);

  // SECURITY: Validate userId override to prevent IDOR attacks
  const requestedUserId = query.userId || query.containerTag;
  const userId = resolveUserId(c, requestedUserId);
  const containerTag = query.containerTag;

  try {
    const { ContextBuilder } = await import('../services/context-builder.js');

    const result = await ContextBuilder.getProfile(userId, {
      q: query.q,
      threshold: query.threshold,
      includeRecent: query.includeRecent === 'true',
      containerTag,
    });

    return c.json({
      profile: {
        static: result.profile.static,
        dynamic: result.profile.dynamic,
        staticCount: result.profile.static.length,
        dynamicCount: result.profile.dynamic.length,
      },
      searchResults: result.searchResults || null,
      latencyMs: Date.now() - startTime,
    });
  } catch (error) {
    return internalError(c, error, 'Profile get');
  }
});

// =============================================================================
// POST /v1/profile/search - Profile + search in one call
// =============================================================================

profile.post('/search', async (c) => {
  const startTime = Date.now();

  const userId = c.get('userId');
  if (!userId) {
    return authenticationError(c);
  }

  const body = await validateBody(c, ProfileSearchSchema);
  

  try {
    const { ContextBuilder } = await import('../services/context-builder.js');
    const { RecallService } = await import('../services/recall-service.js');

    // Run profile and search in parallel
    const [profileResult, searchResult] = await Promise.all([
      ContextBuilder.getProfile(userId),
      RecallService.searchMemories(userId, body.query, {
        limit: body.limit,
        searchMode: 'hybrid',
        threshold: body.threshold,
      }),
    ]);

    // Format for LLM context injection
    const contextForLLM = ContextBuilder.formatContextForPrompt(profileResult);

    return c.json({
      profile: {
        static: profileResult.profile.static,
        dynamic: profileResult.profile.dynamic,
      },
      searchResults: {
        results: searchResult.results.map((r) => ({
          id: r.id,
          content: r.memory,
          score: r.similarity,
          version: r.version,
          updatedAt: r.updatedAt,
        })),
        total: searchResult.total,
      },
      contextForLLM,
      query: body.query,
      latencyMs: Date.now() - startTime,
    });
  } catch (error) {
    return internalError(c, error, 'Profile search');
  }
});

// =============================================================================
// GET /v1/profile/context - Get formatted context for LLM
// =============================================================================

profile.get('/context', async (c) => {
  const startTime = Date.now();

  const userId = c.get('userId');
  if (!userId) {
    return authenticationError(c);
  }

  const queryParam = c.req.query('q');

  try {
    const { ContextBuilder } = await import('../services/context-builder.js');

    const result = await ContextBuilder.getProfile(userId, {
      q: queryParam,
      includeRecent: true,
    });

    // Format as a system prompt injection
    const context = ContextBuilder.formatContextForPrompt(result);

    return c.json({
      context,
      memoryCount: result.profile.static.length + result.profile.dynamic.length,
      hasSearchResults: !!result.searchResults,
      latencyMs: Date.now() - startTime,
    });
  } catch (error) {
    return internalError(c, error, 'Profile context');
  }
});

export default profile;
