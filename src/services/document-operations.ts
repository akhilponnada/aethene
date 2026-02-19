/**
 * Document Operations Service for Aethene
 *
 * Document management - list, get, update, delete, bulk operations.
 */

import { mutateConvex, queryConvex } from '../database/db.js';
import { embedText } from '../vector/embeddings.js';
import { generateSummary } from './memory-extractor.js';

// =============================================================================
// TYPES
// =============================================================================

export interface Document {
  id: string;
  customId?: string;
  content: string;
  contentType: string;
  title?: string;
  summary?: string;
  url?: string;
  containerTags?: string[];
  status: 'pending' | 'processing' | 'completed' | 'failed';
  metadata?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface DocumentListOptions {
  limit?: number;
  page?: number;
  status?: 'pending' | 'processing' | 'completed' | 'failed';
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
}

export interface DocumentListResult {
  documents: Document[];
  pagination: Pagination;
}

export interface DocumentUpdate {
  content?: string;
  title?: string;
  metadata?: Record<string, unknown>;
  status?: 'pending' | 'processing' | 'completed' | 'failed';
}

// =============================================================================
// VALIDATION
// =============================================================================

const MAX_CONTENT_LENGTH = 100000; // 100KB for documents
const VALID_STATUSES = ['pending', 'processing', 'completed', 'failed'];

function validateDocumentUpdate(updates: DocumentUpdate): { valid: boolean; error?: string } {
  if (updates.content !== undefined) {
    if (typeof updates.content !== 'string') {
      return { valid: false, error: 'Content must be a string' };
    }
    if (updates.content.length > MAX_CONTENT_LENGTH) {
      return { valid: false, error: `Content exceeds maximum length of ${MAX_CONTENT_LENGTH} characters` };
    }
  }

  if (updates.title !== undefined && typeof updates.title !== 'string') {
    return { valid: false, error: 'Title must be a string' };
  }

  if (updates.status !== undefined && !VALID_STATUSES.includes(updates.status)) {
    return { valid: false, error: `Status must be one of: ${VALID_STATUSES.join(', ')}` };
  }

  return { valid: true };
}

// =============================================================================
// INTERNAL HELPERS
// =============================================================================

/**
 * Convert raw Convex document to Document interface
 */
function toDocument(raw: any): Document {
  return {
    id: raw._id,
    customId: raw.custom_id,
    content: raw.content,
    contentType: raw.content_type || 'text',
    title: raw.title,
    summary: raw.summary,
    url: raw.url,
    containerTags: raw.container_tags || [],
    status: raw.status,
    metadata: raw.metadata,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  };
}

// =============================================================================
// CREATE DOCUMENT
// =============================================================================

export interface CreateDocumentOptions {
  content: string;
  url?: string;
  metadata?: Record<string, unknown>;
  containerTags?: string[];
  customId?: string;
  entityContext?: string;
}

/**
 * Create a new document.
 *
 * @param userId - User ID
 * @param options - Document options
 * @returns Created document info
 */
export async function createDocument(
  userId: string,
  options: CreateDocumentOptions
): Promise<{ id: string; workflowInstanceId?: string }> {
  if (!userId) {
    throw new Error('userId is required');
  }

  if (!options.content || options.content.trim() === '') {
    throw new Error('content is required and cannot be empty');
  }

  // Validate content length
  if (options.content.length > 5 * 1024 * 1024) { // 5MB limit
    throw new Error('Content exceeds maximum size of 5MB');
  }

  // Check for existing document with same customId
  if (options.customId) {
    const existing = await getDocumentByCustomId(userId, options.customId);
    if (existing) {
      const error = new Error('Document with this customId already exists');
      (error as any).existingId = existing.id;
      throw error;
    }
  }

  // Generate embedding for the content
  let embedding: number[] | undefined;
  try {
    embedding = await embedText(options.content.slice(0, 8000)); // Limit embedding input
  } catch (e) {
    console.warn('[DocOps] Failed to generate embedding for new document');
  }

  // Generate AI summary for the document
  let summary: string | undefined;
  try {
    summary = await generateSummary(options.content);
  } catch (e) {
    console.warn('[DocOps] Failed to generate summary for new document');
  }

  // Generate a workflow instance ID (for tracking async processing)
  const workflowInstanceId = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

  // Create the document
  const documentId = await mutateConvex('content:create', {
    userId,
    content: options.content,
    contentType: 'text',
    title: undefined, // Will be generated during processing
    summary,
    customId: options.customId,
    containerTags: options.containerTags,  // Pass containerTags for scoping
    metadata: options.metadata || {},
    embedding,
  }) as string | null;

  if (!documentId) {
    throw new Error('Failed to create document');
  }

  return {
    id: documentId,
    workflowInstanceId,
  };
}

// =============================================================================
// LIST DOCUMENTS
// =============================================================================

/**
 * List documents for a user with pagination.
 *
 * @param userId - User ID
 * @param options - Pagination and filter options
 * @returns Paginated list of documents
 */
export async function listDocuments(
  userId: string,
  options: DocumentListOptions = {}
): Promise<DocumentListResult> {
  if (!userId) {
    throw new Error('userId is required');
  }

  const { limit = 50, page = 1, status } = options;

  // Validate pagination
  const safeLimit = Math.min(Math.max(1, limit), 100);
  const safePage = Math.max(1, page);

  // Fetch documents
  const rawDocuments = await queryConvex<any[]>('content:list', {
    userId,
    limit: safeLimit + 1, // Fetch one extra to check hasMore
    status,
  });

  if (!rawDocuments) {
    return {
      documents: [],
      pagination: {
        page: safePage,
        limit: safeLimit,
        total: 0,
        hasMore: false,
      },
    };
  }

  // Check if there are more results
  const hasMore = rawDocuments.length > safeLimit;
  const documents = rawDocuments.slice(0, safeLimit).map(toDocument);

  // Get total count for pagination
  const totalResult = await queryConvex<{ count: number }>('content:count', {
    userId,
    status,
  });
  const total = totalResult?.count ?? documents.length;

  return {
    documents,
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      hasMore,
    },
  };
}

// =============================================================================
// GET DOCUMENT
// =============================================================================

/**
 * Get a single document by ID.
 * Supports both Convex _id and custom/external ID lookup.
 *
 * @param userId - User ID (for ownership verification)
 * @param docId - Document ID (Convex ID or customId)
 * @returns Document or null
 */
export async function getDocument(userId: string, docId: string): Promise<Document | null> {
  if (!userId) {
    throw new Error('userId is required');
  }

  if (!docId) {
    throw new Error('docId is required');
  }

  let raw: any = null;

  // Try Convex ID lookup first (Convex IDs typically start with 'j' or similar patterns)
  try {
    raw = await queryConvex<any>('content:get', { id: docId });
  } catch (e: any) {
    // Invalid Convex ID format - will try customId lookup below
    if (!e.message?.includes('Invalid argument')) {
      throw e;
    }
  }

  // If not found by Convex ID, try by customId
  if (!raw) {
    raw = await queryConvex<any>('content:getByCustomId', {
      userId,
      customId: docId,
    });
  }

  if (!raw) {
    return null;
  }

  // Verify ownership
  if (raw.user_id !== userId) {
    throw new Error('Access denied: you do not own this document');
  }

  return toDocument(raw);
}

/**
 * Get a document by custom ID.
 *
 * @param userId - User ID
 * @param customId - Custom ID
 * @returns Document or null
 */
export async function getDocumentByCustomId(
  userId: string,
  customId: string
): Promise<Document | null> {
  if (!userId || !customId) {
    throw new Error('userId and customId are required');
  }

  const raw = await queryConvex<any>('content:getByCustomId', {
    userId,
    customId,
  });

  if (!raw) {
    return null;
  }

  return toDocument(raw);
}

// =============================================================================
// UPDATE DOCUMENT
// =============================================================================

/**
 * Update a document.
 *
 * @param userId - User ID (for ownership verification)
 * @param docId - Document ID
 * @param updates - Fields to update
 * @returns Updated document
 */
export async function updateDocument(
  userId: string,
  docId: string,
  updates: DocumentUpdate
): Promise<Document> {
  if (!userId) {
    throw new Error('userId is required');
  }

  if (!docId) {
    throw new Error('docId is required');
  }

  // Validate updates
  const validation = validateDocumentUpdate(updates);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  // Verify ownership
  const existing = await getDocument(userId, docId);
  if (!existing) {
    throw new Error('Document not found');
  }

  // Use actual Convex ID (docId could be a customId)
  const convexId = existing.id;

  // Build update object
  const updateArgs: any = { id: convexId };

  if (updates.content !== undefined) {
    updateArgs.content = updates.content;
    // Regenerate embedding if content changed
    try {
      updateArgs.embedding = await embedText(updates.content);
    } catch (e) {
      console.warn('[DocOps] Failed to generate embedding for update');
    }
  }

  if (updates.title !== undefined) {
    updateArgs.title = updates.title;
  }

  if (updates.metadata !== undefined) {
    updateArgs.metadata = updates.metadata;
  }

  // Apply update
  const result = await mutateConvex('content:update', updateArgs);

  if (!result) {
    throw new Error('Failed to update document');
  }

  // Handle status update separately if provided
  if (updates.status !== undefined) {
    await mutateConvex('content:updateStatus', {
      id: convexId,
      status: updates.status,
    });
  }

  // Return updated document (use convexId for lookup)
  const updated = await getDocument(userId, convexId);
  if (!updated) {
    throw new Error('Failed to retrieve updated document');
  }

  return updated;
}

// =============================================================================
// DELETE DOCUMENT
// =============================================================================

/**
 * Delete a document and its associated chunks.
 *
 * @param userId - User ID (for ownership verification)
 * @param docId - Document ID
 */
export async function deleteDocument(userId: string, docId: string): Promise<void> {
  if (!userId) {
    throw new Error('userId is required');
  }

  if (!docId) {
    throw new Error('docId is required');
  }

  // Verify ownership
  const existing = await getDocument(userId, docId);
  if (!existing) {
    throw new Error('Document not found');
  }

  // Use actual Convex ID (docId could be a customId)
  const convexId = existing.id;

  // Delete document (convex function handles chunk deletion)
  const result = await mutateConvex('content:remove', { id: convexId });

  if (!result) {
    throw new Error('Failed to delete document');
  }
}

/**
 * Delete a document by custom ID.
 *
 * @param userId - User ID
 * @param customId - Custom ID
 */
export async function deleteDocumentByCustomId(userId: string, customId: string): Promise<void> {
  if (!userId || !customId) {
    throw new Error('userId and customId are required');
  }

  const result = await mutateConvex('content:removeByCustomId', {
    userId,
    customId,
  }) as { success?: boolean; error?: string } | null;

  if (!result || result.success === false) {
    throw new Error(result?.error || 'Document not found');
  }
}

// =============================================================================
// BULK DELETE DOCUMENTS
// =============================================================================

/**
 * Delete multiple documents at once.
 *
 * @param userId - User ID
 * @param docIds - Array of document IDs to delete
 * @returns Results for each document
 */
export async function bulkDeleteDocuments(
  userId: string,
  docIds: string[]
): Promise<{ deleted: string[]; errors: Array<{ id: string; error: string }> }> {
  if (!userId) {
    throw new Error('userId is required');
  }

  if (!docIds || !Array.isArray(docIds) || docIds.length === 0) {
    throw new Error('docIds array is required and cannot be empty');
  }

  // Rate limit bulk operations
  if (docIds.length > 50) {
    throw new Error('Maximum 50 documents per bulk delete request');
  }

  const deleted: string[] = [];
  const errors: Array<{ id: string; error: string }> = [];

  // Process in parallel with concurrency limit
  const CONCURRENCY = 5;
  const batches = [];
  for (let i = 0; i < docIds.length; i += CONCURRENCY) {
    batches.push(docIds.slice(i, i + CONCURRENCY));
  }

  for (const batch of batches) {
    await Promise.all(
      batch.map(async (docId) => {
        try {
          await deleteDocument(userId, docId);
          deleted.push(docId);
        } catch (error: any) {
          errors.push({ id: docId, error: error.message });
        }
      })
    );
  }

  return { deleted, errors };
}

// =============================================================================
// GET PROCESSING QUEUE
// =============================================================================

/**
 * Get documents that are pending or processing.
 *
 * @param userId - User ID
 * @returns Array of documents in the processing queue
 */
export async function getProcessingQueue(userId: string): Promise<Document[]> {
  if (!userId) {
    throw new Error('userId is required');
  }

  // Get pending documents
  const pendingDocs = await queryConvex<any[]>('content:list', {
    userId,
    status: 'pending',
    limit: 100,
  });

  // Get processing documents
  const processingDocs = await queryConvex<any[]>('content:list', {
    userId,
    status: 'processing',
    limit: 100,
  });

  const allDocs = [
    ...(pendingDocs || []),
    ...(processingDocs || []),
  ];

  // Sort by created_at (oldest first for queue order)
  allDocs.sort((a, b) => a.created_at - b.created_at);

  return allDocs.map(toDocument);
}

// =============================================================================
// GET DOCUMENT CHUNKS
// =============================================================================

/**
 * Get chunks for a document.
 *
 * @param userId - User ID (for ownership verification)
 * @param docId - Document ID
 * @returns Array of chunks
 */
export async function getDocumentChunks(
  userId: string,
  docId: string
): Promise<Array<{
  id: string;
  content: string;
  chunkIndex: number;
  createdAt: number;
}>> {
  if (!userId || !docId) {
    throw new Error('userId and docId are required');
  }

  // Verify ownership
  const doc = await getDocument(userId, docId);
  if (!doc) {
    throw new Error('Document not found');
  }

  // Use actual Convex ID (docId could be a customId)
  const convexId = doc.id;

  const chunks = await queryConvex<any[]>('chunks:getByDocument', {
    documentId: convexId,
  });

  if (!chunks) {
    return [];
  }

  return chunks.map(c => ({
    id: c._id,
    content: c.content,
    chunkIndex: c.chunk_index,
    createdAt: c.created_at,
  }));
}

// =============================================================================
// REPROCESS DOCUMENT
// =============================================================================

/**
 * Requeue a document for processing.
 *
 * @param userId - User ID
 * @param docId - Document ID
 */
export async function reprocessDocument(userId: string, docId: string): Promise<void> {
  if (!userId || !docId) {
    throw new Error('userId and docId are required');
  }

  // Verify ownership
  const doc = await getDocument(userId, docId);
  if (!doc) {
    throw new Error('Document not found');
  }

  // Use actual Convex ID (docId could be a customId)
  const convexId = doc.id;

  // Reset status to pending
  await mutateConvex('content:updateStatus', {
    id: convexId,
    status: 'pending',
  });

  // Optionally delete existing chunks for re-chunking
  await mutateConvex('chunks:deleteByDocument', {
    documentId: convexId,
  });
}

// =============================================================================
// DOCUMENT STATS
// =============================================================================

/**
 * Get document statistics for a user.
 *
 * @param userId - User ID
 * @returns Document statistics
 */
export async function getDocumentStats(
  userId: string
): Promise<{
  total: number;
  pending: number;
  processing: number;
  completed: number;
  failed: number;
}> {
  if (!userId) {
    throw new Error('userId is required');
  }

  const [total, pending, processing, completed, failed] = await Promise.all([
    queryConvex<{ count: number }>('content:count', { userId }),
    queryConvex<{ count: number }>('content:count', { userId, status: 'pending' }),
    queryConvex<{ count: number }>('content:count', { userId, status: 'processing' }),
    queryConvex<{ count: number }>('content:count', { userId, status: 'completed' }),
    queryConvex<{ count: number }>('content:count', { userId, status: 'failed' }),
  ]);

  return {
    total: total?.count ?? 0,
    pending: pending?.count ?? 0,
    processing: processing?.count ?? 0,
    completed: completed?.count ?? 0,
    failed: failed?.count ?? 0,
  };
}
