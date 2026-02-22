/**
 * Hono Type Definitions for Aethene API
 */
import type { Context } from 'hono';

/**
 * Permissions for scoped API keys
 */
export type ApiKeyPermission = 'read' | 'write' | 'delete' | 'admin';

/**
 * Variables available in the Hono context
 */
export interface AppVariables {
  userId: string;
  apiKey?: string;
  rateLimit?: number;
  keyProvider?: 'static' | 'convex';
  // Scoped API key context
  isScoped?: boolean;
  containerTags?: string[];
  permissions?: ApiKeyPermission[];
  // Request tracking
  requestId?: string;
}

/**
 * Environment type for Hono app
 */
export interface AppEnv {
  Variables: AppVariables;
}

/**
 * Helper type for route handlers
 */
export type AppContext = Context<AppEnv>;
