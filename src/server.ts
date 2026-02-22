/**
 * Aethene API Server
 *
 * The AI Memory Layer - Simple, fast, and powerful memory API.
 *
 * All endpoints under /v1/* - Clean, unified API
 */

import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { bodyLimit } from 'hono/body-limit';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Database
import { initializeDb } from './database/db.js';

// Middleware
import { apiKeyAuth } from './middleware/auth.js';
import { globalRateLimiter, cleanupRateLimitRecords } from './middleware/rate-limiter.js';

// v1 Routes
import memoriesRoutes from './routes/memories.js';
import contentRoutes from './routes/content.js';
import searchRoutes from './routes/search.js';
import profileRoutes from './routes/profile.js';
import recallRoutes from './routes/recall.js';
import contextRoutes from './routes/context.js';
import relationsRoutes from './routes/relations.js';
import documentsRoutes from './routes/documents.js';   // Document operations
import settingsRoutes from './routes/settings.js';      // User settings
import authRoutes from './routes/auth.js';              // API key management
import entitiesRoutes from './routes/entities.js';      // Entity graph routes

// =============================================================================
// INITIALIZE
// =============================================================================

// Initialize database connection
try {
  initializeDb();
  console.log('[Aethene] Database connected');
} catch (error) {
  console.error('[Aethene] Database initialization failed:', error);
}

// =============================================================================
// APP SETUP
// =============================================================================

const app = new Hono();

// =============================================================================
// SECURITY MIDDLEWARE
// =============================================================================

// Security headers (CSP, HSTS, X-Frame-Options, etc.)
app.use('/*', secureHeaders());

// Body size limit (10MB max to prevent DoS)
app.use('/*', bodyLimit({
  maxSize: 10 * 1024 * 1024, // 10MB
  onError: (c) => {
    return c.json({
      error: 'Request body too large',
      code: 'PAYLOAD_TOO_LARGE',
      maxSize: '10MB',
    }, 413);
  },
}));

// CORS middleware - configurable origins for production
const allowedOrigins = process.env.CORS_ORIGINS?.split(',').map(o => o.trim()) || [];
const isProduction = process.env.NODE_ENV === 'production';

app.use('/*', cors({
  origin: isProduction && allowedOrigins.length > 0
    ? (origin) => allowedOrigins.includes(origin) ? origin : null
    : '*', // Allow all in development
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
  exposeHeaders: ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset'],
  maxAge: 86400,
  credentials: isProduction,
}));

// =============================================================================
// HEALTH CHECK (Public)
// =============================================================================

app.get('/health', (c) => {
  return c.json({
    status: 'healthy',
    service: 'aethene',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

// =============================================================================
// API INFO (Public)
// =============================================================================

app.get('/', (c) => {
  return c.json({
    name: 'Aethene API',
    description: 'The AI Memory Layer',
    version: '1.0.0',
    docs: 'https://docs.aethene.com',
    endpoints: {
      // Memory Operations
      memories: {
        create: 'POST /v1/memories',
        list: 'GET /v1/memories',
        get: 'GET /v1/memories/:id',
        update: 'PATCH /v1/memories/:id',
        forget: 'POST /v1/memories/:id/forget',
        restore: 'POST /v1/memories/:id/restore',
      },
      // Document Operations
      documents: {
        create: 'POST /v1/documents',
        upload: 'POST /v1/documents/file',
        list: 'POST /v1/documents/list',
        get: 'GET /v1/documents/:id',
        update: 'PATCH /v1/documents/:id',
        delete: 'DELETE /v1/documents/:id',
        bulkDelete: 'DELETE /v1/documents/bulk',
        search: 'POST /v1/documents/search',
        processing: 'GET /v1/documents/processing',
      },
      // Search & Recall
      search: 'POST /v1/search',
      recall: 'POST /v1/recall',
      // User Data
      profile: 'GET /v1/profile',
      context: 'POST /v1/context',
      settings: {
        get: 'GET /v1/settings',
        update: 'PATCH /v1/settings',
      },
      // Relationships
      relations: {
        list: 'GET /v1/relations',
        graph: 'GET /v1/relations/graph',
      },
      // API Key Management
      auth: {
        createKey: 'POST /v1/auth/keys',
        listKeys: 'GET /v1/auth/keys',
        revokeKey: 'DELETE /v1/auth/keys/:id',
        keyInfo: 'GET /v1/auth/key-info',
      },
    },
  });
});

// =============================================================================
// API ROUTES (Protected)
// =============================================================================

// Apply auth and rate limiting to /v1/*
app.use('/v1/*', globalRateLimiter);
app.use('/v1/*', apiKeyAuth);

// Memory operations
app.route('/v1/memories', memoriesRoutes);

// Document operations (ingest, upload, process)
app.route('/v1/content', contentRoutes);
app.route('/v1/documents', documentsRoutes);

// Search & Recall
app.route('/v1/search', searchRoutes);
app.route('/v1/recall', recallRoutes);

// User data
app.route('/v1/profile', profileRoutes);
app.route('/v1/context', contextRoutes);
app.route('/v1/settings', settingsRoutes);

// Memory relations
app.route('/v1', relationsRoutes);

// API key management
app.route('/v1/auth', authRoutes);

// Entity graph (Supermemory-compatible semantic graph)
app.route('/v1/entities', entitiesRoutes);

// =============================================================================
// 404 HANDLER
// =============================================================================

app.notFound((c) => {
  return c.json({
    error: 'Not found',
    code: 'NOT_FOUND',
    message: `Route ${c.req.method} ${c.req.path} not found`,
  }, 404);
});

// =============================================================================
// ERROR HANDLER
// =============================================================================

import { ValidationError } from './utils/errors.js';

app.onError((err, c) => {
  // Handle validation errors with 400
  if (err instanceof ValidationError) {
    return c.json({
      error: err.message,
      code: err.code,
      details: err.details,
    }, 400);
  }

  // Handle JSON parse errors with 400
  if (err instanceof SyntaxError && err.message?.includes('JSON')) {
    return c.json({
      error: 'Invalid JSON in request body',
      code: 'BAD_REQUEST',
    }, 400);
  }

  // Handle other parsing/validation errors
  if (err.message?.includes('Invalid') || err.message?.includes('Unexpected')) {
    return c.json({
      error: err.message,
      code: 'BAD_REQUEST',
    }, 400);
  }

  console.error('[Aethene] Unhandled error:', err);

  // Don't leak error details in production
  return c.json({
    error: 'Internal server error',
    code: 'INTERNAL_ERROR',
  }, 500);
});

const PORT = parseInt(process.env.PORT || '3006', 10);

// =============================================================================
// RATE LIMIT CLEANUP (every 5 minutes)
// =============================================================================

setInterval(() => {
  const cleaned = cleanupRateLimitRecords();
  if (cleaned > 0) {
    console.log(`[RateLimit] Cleaned ${cleaned} expired records`);
  }
}, 5 * 60 * 1000);

// =============================================================================
// START SERVER
// =============================================================================

serve({
  fetch: app.fetch,
  port: PORT,
}, (info) => {
  console.log('');
  console.log('  ╔═══════════════════════════════════════════════════════╗');
  console.log('  ║                                                       ║');
  console.log('  ║       AETHENE - The AI Memory Layer                   ║');
  console.log('  ║                                                       ║');
  console.log(`  ║       Server: http://localhost:${info.port}                   ║`);
  console.log(`  ║       Health: http://localhost:${info.port}/health             ║`);
  console.log('  ║                                                       ║');
  console.log('  ╚═══════════════════════════════════════════════════════╝');
  console.log('');
  console.log('  Aethene v1 API:');
  console.log('');
  console.log('  Memories:');
  console.log('  ├── POST   /v1/memories              Create memories');
  console.log('  ├── GET    /v1/memories              List memories');
  console.log('  ├── GET    /v1/memories/:id          Get memory');
  console.log('  ├── PATCH  /v1/memories/:id          Update memory');
  console.log('  └── POST   /v1/memories/:id/forget   Forget memory');
  console.log('');
  console.log('  Documents:');
  console.log('  ├── POST   /v1/documents             Create document');
  console.log('  ├── POST   /v1/documents/file        Upload file');
  console.log('  ├── POST   /v1/documents/list        List documents');
  console.log('  ├── GET    /v1/documents/:id         Get document');
  console.log('  ├── PATCH  /v1/documents/:id         Update document');
  console.log('  ├── DELETE /v1/documents/:id         Delete document');
  console.log('  ├── DELETE /v1/documents/bulk        Bulk delete');
  console.log('  └── POST   /v1/documents/search      Search documents');
  console.log('');
  console.log('  Search & User:');
  console.log('  ├── POST   /v1/search                Search all');
  console.log('  ├── POST   /v1/recall                Intelligent recall');
  console.log('  ├── GET    /v1/profile               User profile');
  console.log('  ├── POST   /v1/context               LLM context');
  console.log('  └── GET/PATCH /v1/settings           User settings');
  console.log('');
  console.log('  Auth:');
  console.log('  ├── POST   /v1/auth/keys             Create API key');
  console.log('  ├── GET    /v1/auth/keys             List API keys');
  console.log('  ├── DELETE /v1/auth/keys/:id         Revoke key');
  console.log('  └── GET    /v1/auth/key-info         Current key info');
  console.log('');
});

export default app;
