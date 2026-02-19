/**
 * Convex Client Wrapper for Aethene
 *
 * Provides typed access to Convex database operations
 */

import { ConvexHttpClient } from 'convex/browser';

// =============================================================================
// CLIENT SINGLETON
// =============================================================================

let client: ConvexHttpClient | null = null;

/**
 * Get the Convex client (initializes on first use)
 */
export function getConvexClient(): ConvexHttpClient {
  if (!client) {
    const url = process.env.CONVEX_URL;
    if (!url) {
      throw new Error('CONVEX_URL environment variable is required');
    }
    client = new ConvexHttpClient(url);
  }
  return client;
}

// =============================================================================
// TYPED WRAPPERS
// =============================================================================

/**
 * Execute a Convex query
 */
export async function query<T = unknown>(
  funcName: string,
  args: Record<string, unknown> = {}
): Promise<T> {
  const c = getConvexClient();
  // Use 'as any' to bypass strict Convex typing for dynamic function calls
  return c.query(funcName as any, args as any) as Promise<T>;
}

/**
 * Execute a Convex mutation
 */
export async function mutation<T = unknown>(
  funcName: string,
  args: Record<string, unknown> = {}
): Promise<T> {
  const c = getConvexClient();
  return c.mutation(funcName as any, args as any) as Promise<T>;
}

/**
 * Execute a Convex action
 */
export async function action<T = unknown>(
  funcName: string,
  args: Record<string, unknown> = {}
): Promise<T> {
  const c = getConvexClient();
  return c.action(funcName as any, args as any) as Promise<T>;
}

// =============================================================================
// EXPORTS
// =============================================================================

export const ConvexClient = {
  get: getConvexClient,
  query,
  mutation,
  action
};

export default ConvexClient;
