/**
 * Aethene Database Layer
 * Simple Convex client setup with query/mutation helpers
 */

import { ConvexHttpClient } from 'convex/browser';

// =============================================================================
// DATABASE CLIENT
// =============================================================================

let client: ConvexHttpClient | null = null;

/**
 * Initialize the Convex client
 */
export function initializeDb(): ConvexHttpClient {
  if (!client) {
    const url = process.env.CONVEX_URL;
    if (!url) {
      throw new Error('CONVEX_URL environment variable is not set');
    }
    client = new ConvexHttpClient(url);
  }
  return client;
}

/**
 * Get the Convex client (auto-initializes if needed)
 */
export function getDb(): ConvexHttpClient {
  if (!client) {
    if (process.env.CONVEX_URL) {
      return initializeDb();
    }
    throw new Error('Database not initialized. Call initializeDb() first or set CONVEX_URL.');
  }
  return client;
}

// =============================================================================
// CONVEX HELPERS
// =============================================================================

type ConvexArgs = Record<string, unknown>;

/**
 * Execute a Convex query
 *
 * @example
 * const facts = await queryConvex('userFacts:getByUser', { userId: 'user123', limit: 10 });
 */
export async function queryConvex<T = unknown>(
  funcName: string,
  args: ConvexArgs
): Promise<T | null> {
  try {
    const db = getDb();
    const result = await db.query(funcName as any, args as any);
    return result as T;
  } catch (error) {
    console.error(`[DB] Query ${funcName} failed:`, error);
    return null;
  }
}

/**
 * Execute a Convex mutation
 *
 * @example
 * await mutateConvex('memories:insert', { userId, content, embedding });
 */
export async function mutateConvex<T = unknown>(
  funcName: string,
  args: ConvexArgs
): Promise<T | null> {
  try {
    const db = getDb();
    const result = await db.mutation(funcName as any, args as any);
    return result as T;
  } catch (error) {
    console.error(`[DB] Mutation ${funcName} failed:`, error);
    return null;
  }
}

/**
 * Execute a Convex action (can call external services)
 *
 * @example
 * const results = await actionConvex('vectorSearch:search', { userId, embedding, limit: 10 });
 */
export async function actionConvex<T = unknown>(
  funcName: string,
  args: ConvexArgs
): Promise<T | null> {
  try {
    const db = getDb();
    const result = await db.action(funcName as any, args as any);
    return result as T;
  } catch (error) {
    console.error(`[DB] Action ${funcName} failed:`, error);
    return null;
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

export { getDb as getConvexClient };
