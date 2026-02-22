/**
 * Document Routes for Aethene API
 *
 * POST /v1/documents - Create document
 * POST /v1/documents/file - Upload file (multipart form)
 * POST /v1/documents/list - List documents (paginated)
 * GET /v1/documents/:id - Get specific document
 * PATCH /v1/documents/:id - Update document
 * DELETE /v1/documents/:id - Delete document
 * DELETE /v1/documents/bulk - Bulk delete documents
 * POST /v1/documents/search - Search documents
 * GET /v1/documents/processing - Get processing queue
 */

import { Hono } from 'hono';
import type { AppEnv } from '../types/hono.js';
import { z } from 'zod';
import {
  authenticationError,
  notFoundError,
  internalError,
  validationError,
} from '../utils/errors.js';

const documents = new Hono<AppEnv>();

// =============================================================================
// SCHEMAS
// =============================================================================

const ListDocumentsV3Schema = z.object({
  page: z.number().min(1).optional().default(1),
  limit: z.number().min(1).max(100).optional().default(50),
  status: z.enum(['pending', 'processing', 'completed', 'failed']).optional(),
});

const UpdateDocumentV3Schema = z.object({
  content: z.string().min(1).max(100000).optional(),
  title: z.string().max(500).optional(),
  metadata: z.record(z.unknown()).optional(),
  status: z.enum(['pending', 'processing', 'completed', 'failed']).optional(),
});

const BulkDeleteV3Schema = z.object({
  ids: z.array(z.string()).min(1).max(50),
  containerTags: z.array(z.string()).optional(),
});

const CreateDocumentV3Schema = z.object({
  content: z.string().min(1),
  url: z.string().url().optional(),
  metadata: z.record(z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.array(z.string()),
  ])).optional(),
  containerTags: z.array(z.string()).optional(),
  containerTag: z.string().optional(), // Supermemory accepts both
  customId: z.string().optional(),
  entityContext: z.string().optional(),
  chunkSize: z.number().optional(),
});

// =============================================================================
// POST /v3/documents - Create document with text content (Supermemory compatible)
// =============================================================================

documents.post('/', async (c) => {
  const startTime = Date.now();

  const userId = c.get('userId');
  if (!userId) {
    return authenticationError(c);
  }

  let body: z.infer<typeof CreateDocumentV3Schema>;
  try {
    const raw = await c.req.json();
    body = CreateDocumentV3Schema.parse(raw);
  } catch (error: any) {
    // Supermemory error format
    if (error.issues) {
      return c.json({
        data: {},
        error: error.issues.map((issue: any) => ({
          path: issue.path,
          message: issue.message,
        })),
        success: false,
      }, 400);
    }
    return validationError(c, error.message || 'Invalid request body');
  }

  // Validate content is not empty
  if (!body.content || body.content.trim() === '') {
    return c.json({
      error: 'Cannot extract content: No content provided. Content field is empty',
      details: 'Invalid document parameters provided',
    }, 400);
  }

  try {
    const { ingestContent } = await import('../services/ingest-service.js');

    // Handle containerTag vs containerTags (Supermemory accepts both)
    const containerTags = body.containerTags || (body.containerTag ? [body.containerTag] : undefined);

    // Use ingestContent which triggers async memory extraction
    const result = await ingestContent(userId, body.content, {
      contentType: body.url ? 'url' : 'text',
      customId: body.customId,
      metadata: body.metadata,
      containerTags,
      entityContext: body.entityContext,
    });

    // Supermemory v3 response format
    return c.json({
      id: result.id,
      status: result.status,
      workflowInstanceId: result.workflowInstanceId,
    }, 201);
  } catch (error: any) {
    // Handle duplicate customId - return existing document
    if (error.message?.includes('already exists')) {
      const existingId = error.existingId;
      return c.json({
        id: existingId,
        status: 'queued',
      }, 200);
    }
    return internalError(c, error, 'document create');
  }
});

// =============================================================================
// POST /v3/documents/file - Upload file (multipart form data)
// Supermemory-compatible file upload endpoint
// =============================================================================

documents.post('/file', async (c) => {
  const startTime = Date.now();

  const userId = c.get('userId');
  if (!userId) {
    return authenticationError(c);
  }

  try {
    // Parse multipart form data
    const formData = await c.req.formData();

    // Get the file
    const file = formData.get('file');
    if (!file || !(file instanceof File)) {
      return validationError(c, 'No file provided. Use multipart form with "file" field.');
    }

    // Get optional parameters
    const containerTag = formData.get('containerTag')?.toString() ||
                         formData.get('containerTags')?.toString();
    const customId = formData.get('customId')?.toString();
    const entityContext = formData.get('entityContext')?.toString();

    // Parse metadata if provided
    let metadata: Record<string, any> = {};
    const metadataStr = formData.get('metadata')?.toString();
    if (metadataStr) {
      try {
        metadata = JSON.parse(metadataStr);
      } catch {
        // Ignore invalid metadata JSON
      }
    }

    // Import and use file processing service
    const { FileProcessingService } = await import('../services/file-processing-service.js');

    const result = await FileProcessingService.processFileUpload(userId, file, {
      containerTag,
      customId,
      metadata,
      entityContext,
    });

    // Supermemory v3 response format
    return c.json({
      id: result.id,
      status: result.status,
      workflowInstanceId: result.workflowInstanceId,
      file: {
        name: result.fileName,
        type: result.fileType,
        size: result.fileSize,
      },
      message: 'File uploaded and queued for processing',
      timing: Date.now() - startTime,
    }, 202);
  } catch (error: any) {
    // Handle specific errors
    if (error.message?.includes('File size exceeds')) {
      return c.json({
        error: 'File too large',
        code: 'FILE_TOO_LARGE',
        message: error.message,
        maxSize: '50MB',
      }, 413);
    }

    if (error.message?.includes('Unsupported file type')) {
      return c.json({
        error: 'Unsupported file type',
        code: 'UNSUPPORTED_FILE_TYPE',
        message: error.message,
      }, 415);
    }

    return internalError(c, error, 'file upload');
  }
});

// =============================================================================
// GET /v3/documents/file/types - Get supported file types
// =============================================================================

documents.get('/file/types', async (c) => {
  const userId = c.get('userId');
  if (!userId) {
    return authenticationError(c);
  }

  try {
    const { FileProcessingService } = await import('../services/file-processing-service.js');

    const types = FileProcessingService.getSupportedFileTypes();

    return c.json({
      supportedTypes: types,
      maxFileSize: FileProcessingService.MAX_FILE_SIZE,
      maxFileSizeMB: FileProcessingService.MAX_FILE_SIZE / (1024 * 1024),
    });
  } catch (error) {
    return internalError(c, error, 'file types');
  }
});

// =============================================================================
// POST /v3/documents/list - List documents (Supermemory uses POST)
// =============================================================================

documents.post('/list', async (c) => {
  const userId = c.get('userId');
  if (!userId) {
    return authenticationError(c);
  }

  let body: z.infer<typeof ListDocumentsV3Schema>;
  try {
    const raw = await c.req.json().catch(() => ({}));
    body = ListDocumentsV3Schema.parse(raw);
  } catch (error: any) {
    return validationError(c, error.message || 'Invalid request body');
  }

  try {
    const { listDocuments } = await import('../services/document-operations.js');

    const result = await listDocuments(userId, {
      limit: body.limit,
      page: body.page,
      status: body.status,
    });

    // Supermemory v3 response format
    return c.json({
      memories: result.documents.map(doc => ({
        id: doc.id,
        customId: doc.customId || null,
        containerTags: doc.containerTags || [userId],
        createdAt: new Date(doc.createdAt).toISOString(),
        updatedAt: new Date(doc.updatedAt).toISOString(),
        title: doc.title || null,
        type: doc.contentType,
        status: doc.status,
        metadata: doc.metadata || {},
        summary: null,
        connectionId: null,
        source: 'api',
        url: doc.url || null,
        ogImage: null,
        raw: null,
        spatialPoint: null,
        userId: userId,
      })),
      pagination: {
        currentPage: result.pagination.page,
        limit: result.pagination.limit,
        totalItems: result.pagination.total,
        totalPages: Math.ceil(result.pagination.total / result.pagination.limit),
      },
    });
  } catch (error) {
    return internalError(c, error, 'documents list');
  }
});

// =============================================================================
// GET /v3/documents/processing - Get processing queue
// IMPORTANT: This must be BEFORE /:id route to avoid path conflict
// =============================================================================

documents.get('/processing', async (c) => {
  const userId = c.get('userId');
  if (!userId) {
    return authenticationError(c);
  }

  try {
    const { getProcessingQueue, getDocumentStats } = await import('../services/document-operations.js');

    const [queue, stats] = await Promise.all([
      getProcessingQueue(userId),
      getDocumentStats(userId),
    ]);

    // Supermemory-like response format
    return c.json({
      queue: queue.map(doc => ({
        id: doc.id,
        customId: doc.customId || null,
        title: doc.title || null,
        status: doc.status,
        createdAt: new Date(doc.createdAt).toISOString(),
        updatedAt: new Date(doc.updatedAt).toISOString(),
      })),
      stats: {
        total: stats.total,
        pending: stats.pending,
        processing: stats.processing,
        completed: stats.completed,
        failed: stats.failed,
      },
      queueLength: queue.length,
    });
  } catch (error) {
    return internalError(c, error, 'documents processing');
  }
});

// =============================================================================
// GET /v3/documents/:id - Get specific document
// =============================================================================

documents.get('/:id', async (c) => {
  const userId = c.get('userId');
  if (!userId) {
    return authenticationError(c);
  }

  const docId = c.req.param('id');

  try {
    const { getDocument, getDocumentChunks } = await import('../services/document-operations.js');

    const document = await getDocument(userId, docId);

    if (!document) {
      return notFoundError(c, 'Document');
    }

    // Get chunks for the document (use actual Convex ID, not the potentially customId docId)
    let chunks: any[] = [];
    try {
      chunks = await getDocumentChunks(userId, document.id);
    } catch {
      // Continue without chunks
    }

    // Supermemory v3 response format
    return c.json({
      id: document.id,
      customId: document.customId || null,
      containerTags: document.containerTags || [userId],
      createdAt: new Date(document.createdAt).toISOString(),
      updatedAt: new Date(document.updatedAt).toISOString(),
      title: document.title || null,
      summary: null,
      ogImage: null,
      source: 'api',
      url: (document.metadata as any)?.url || null,
      userId: userId,
      raw: null,
      connectionId: null,
      spatialPoint: null,
      content: document.content,
      type: document.contentType,
      status: document.status,
      metadata: document.metadata || {},
      chunks: chunks.map(ch => ({
        id: ch.id,
        content: ch.content,
        position: ch.chunkIndex,
        createdAt: new Date(ch.createdAt).toISOString(),
      })),
    });
  } catch (error: any) {
    if (error.message.includes('Access denied')) {
      return c.json({
        error: 'Access denied',
        code: 'AUTHORIZATION_ERROR',
      }, 403);
    }
    return internalError(c, error, 'document get');
  }
});

// =============================================================================
// PATCH /v3/documents/:id - Update document
// =============================================================================

documents.patch('/:id', async (c) => {
  const userId = c.get('userId');
  if (!userId) {
    return authenticationError(c);
  }

  const docId = c.req.param('id');

  let body: z.infer<typeof UpdateDocumentV3Schema>;
  try {
    const raw = await c.req.json();
    body = UpdateDocumentV3Schema.parse(raw);
  } catch (error: any) {
    return validationError(c, error.message || 'Invalid request body');
  }

  // Check that at least one field is provided
  if (!body.content && !body.title && body.metadata === undefined && !body.status) {
    return validationError(c, 'At least one field (content, title, metadata, status) must be provided');
  }

  try {
    const { updateDocument } = await import('../services/document-operations.js');

    const updated = await updateDocument(userId, docId, {
      content: body.content,
      title: body.title,
      metadata: body.metadata,
      status: body.status,
    });

    // Supermemory v3 response format
    return c.json({
      id: updated.id,
      customId: updated.customId || null,
      containerTags: updated.containerTags || [userId],
      createdAt: new Date(updated.createdAt).toISOString(),
      updatedAt: new Date(updated.updatedAt).toISOString(),
      title: updated.title || null,
      type: updated.contentType,
      status: updated.status,
      metadata: updated.metadata || {},
    });
  } catch (error: any) {
    if (error.message === 'Document not found') {
      return notFoundError(c, 'Document');
    }
    if (error.message.includes('Access denied')) {
      return c.json({
        error: 'Access denied',
        code: 'AUTHORIZATION_ERROR',
      }, 403);
    }
    return internalError(c, error, 'document update');
  }
});

// =============================================================================
// DELETE /v3/documents/bulk - Bulk delete documents
// IMPORTANT: Must be defined BEFORE /:id to avoid route conflicts
// =============================================================================

documents.delete('/bulk', async (c) => {
  const startTime = Date.now();

  const userId = c.get('userId');
  if (!userId) {
    return authenticationError(c);
  }

  let body: z.infer<typeof BulkDeleteV3Schema>;
  try {
    const raw = await c.req.json();
    body = BulkDeleteV3Schema.parse(raw);
  } catch (error: any) {
    return validationError(c, error.message || 'Invalid request body');
  }

  try {
    const { bulkDeleteDocuments } = await import('../services/document-operations.js');

    const result = await bulkDeleteDocuments(userId, body.ids);

    // Supermemory v3 response format
    return c.json({
      success: true,
      deleted: result.deleted.length,
      deletedIds: result.deleted,
      errors: result.errors.length > 0 ? result.errors : undefined,
      timing: Date.now() - startTime,
    });
  } catch (error: any) {
    if (error.message?.includes('Maximum')) {
      return validationError(c, error.message);
    }
    return internalError(c, error, 'documents bulk delete');
  }
});

// =============================================================================
// DELETE /v3/documents/:id - Delete document
// =============================================================================

documents.delete('/:id', async (c) => {
  const userId = c.get('userId');
  if (!userId) {
    return authenticationError(c);
  }

  const docId = c.req.param('id');

  try {
    const { deleteDocument } = await import('../services/document-operations.js');

    await deleteDocument(userId, docId);

    // Supermemory v3 response format
    return c.json({
      success: true,
      message: 'Document deleted',
      id: docId,
    });
  } catch (error: any) {
    if (error.message === 'Document not found') {
      return notFoundError(c, 'Document');
    }
    if (error.message.includes('Access denied')) {
      return c.json({
        error: 'Access denied',
        code: 'AUTHORIZATION_ERROR',
      }, 403);
    }
    return internalError(c, error, 'document delete');
  }
});

// =============================================================================
// POST /v3/search - Document search (v3/search endpoint)
// =============================================================================

documents.post('/search', async (c) => {
  const startTime = Date.now();

  const userId = c.get('userId');
  if (!userId) {
    return authenticationError(c);
  }

  let body: {
    q: string;
    limit?: number;
    filters?: {
      status?: string;
      contentType?: string;
    };
  };

  try {
    body = await c.req.json();
    if (!body.q) {
      return validationError(c, 'Query parameter "q" is required');
    }
  } catch (error: any) {
    return validationError(c, error.message || 'Invalid request body');
  }

  try {
    const { RecallService } = await import('../services/recall-service.js');

    const response = await RecallService.searchDocuments(userId, body.q, {
      limit: body.limit || 10,
      filters: body.filters,
    });

    // Supermemory v3/search response format
    return c.json({
      results: response.results.map(r => ({
        documentId: r.documentId,
        title: r.title,
        type: r.type,
        score: r.score,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        metadata: r.metadata,
        chunks: r.chunks.map(ch => ({
          content: ch.content,
          position: ch.position,
          isRelevant: ch.isRelevant,
          score: ch.score,
        })),
      })),
      timing: Date.now() - startTime,
      total: response.total,
    });
  } catch (error) {
    return internalError(c, error, 'search');
  }
});

export default documents;
