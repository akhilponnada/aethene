/**
 * Routes Index for Aethene API
 *
 * Exports all route modules for easy importing in server.ts
 *
 * All routes under /v1/* - Unified Aethene API
 */

// Memory operations
export { default as memoriesRoutes } from './memories.js';

// Document operations
export { default as documentsRoutes } from './documents.js';
export { default as contentRoutes } from './content.js';

// Search & Recall
export { default as searchRoutes } from './search.js';
export { default as recallRoutes } from './recall.js';

// User data
export { default as profileRoutes } from './profile.js';
export { default as contextRoutes } from './context.js';
export { default as settingsRoutes } from './settings.js';

// Memory relations
export { default as relationsRoutes } from './relations.js';

// Authentication & API keys
export { default as authRoutes } from './auth.js';
