/**
 * Ingest Service - Supermemory-compatible document processing
 *
 * Matches Supermemory's exact workflow:
 * 1. Queue document → return {id, status: "queued", workflowInstanceId}
 * 2. Process async: extracting → chunking → embedding → indexing → done
 * 3. Auto-generate title and summary
 * 4. Extract memories (static/dynamic)
 */

import { ConvexHttpClient } from 'convex/browser';
import { embedText, embedBatch } from '../vector/embeddings.js';
import { chunkText } from './chunking-service.js';
import { extractMemories, generateTitle, generateSummary, ExtractionResult } from './memory-extractor.js';
import { processNewMemory } from './memory-relations.js';
import { UrlFetchService } from './url-fetch-service.js';
import { randomBytes } from 'crypto';

// Document status enum matching Supermemory
export type DocumentStatus = 'queued' | 'extracting' | 'chunking' | 'embedding' | 'indexing' | 'done' | 'failed';

export interface IngestOptions {
  customId?: string;
  containerTag?: string;  // Single container tag
  containerTags?: string[];  // Array of container tags (takes precedence)
  entityContext?: string;
  metadata?: Record<string, any>;
  contentType?: 'text' | 'url' | 'file';
}

export interface IngestResponse {
  id: string;
  status: DocumentStatus;
  workflowInstanceId: string;
}

export interface DocumentInfo {
  id: string;
  customId: string | null;
  containerTags: string[];
  createdAt: string;
  updatedAt: string;
  title: string | null;
  summary: string | null;
  type: string;
  status: DocumentStatus;
  metadata: Record<string, any>;
}

// Convex client
let convex: ConvexHttpClient | null = null;

function getConvex(): ConvexHttpClient {
  if (!convex) {
    const url = process.env.CONVEX_URL;
    if (!url) {
      throw new Error('CONVEX_URL is required');
    }
    convex = new ConvexHttpClient(url);
  }
  return convex;
}

// Generate IDs like Supermemory
function generateId(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  const bytes = randomBytes(22);
  for (let i = 0; i < 22; i++) {
    result += chars[bytes[i] % chars.length];
  }
  return result;
}

function generateWorkflowId(): string {
  return `${randomBytes(4).toString('hex')}-${randomBytes(2).toString('hex')}-${randomBytes(2).toString('hex')}-${randomBytes(2).toString('hex')}-${randomBytes(6).toString('hex')}`;
}

/**
 * Ingest content - Supermemory-compatible
 * Returns immediately with queued status, processes async
 */
export async function ingestContent(
  userId: string,
  content: string,
  options: IngestOptions = {}
): Promise<IngestResponse> {
  const {
    customId,
    containerTag,
    containerTags: containerTagsOption,
    entityContext,
    metadata = {},
    contentType = 'text'
  } = options;

  // Handle containerTag vs containerTags (Supermemory accepts both)
  const containerTags = containerTagsOption || (containerTag ? [containerTag] : undefined);

  const externalId = customId || generateId();
  const workflowInstanceId = generateWorkflowId();

  const client = getConvex();

  // Create document in queued state and get the Convex _id
  let convexDocId: string;
  try {
    convexDocId = await client.mutation('content:create' as any, {
      userId,
      customId: externalId,  // Always store the external ID for lookup
      content,
      contentType,
      containerTags,  // Pass containerTags for scoping
      metadata,
    });
  } catch (e: any) {
    // If document with customId exists, get its ID and re-queue
    if (customId && e.message?.includes('duplicate')) {
      const existing = await client.query('content:getByCustomId' as any, {
        userId,
        customId: externalId,
      });
      if (existing) {
        convexDocId = existing._id;
        // Update will happen in processDocumentAsync
      } else {
        throw e;
      }
    } else {
      throw e;
    }
  }

  // Process async (don't await) - pass Convex _id for updates
  processDocumentAsync(userId, convexDocId, externalId, content, entityContext, metadata, contentType, containerTags).catch(err => {
    console.error(`Background processing failed for ${externalId}:`, err);
  });

  return {
    id: externalId,
    status: 'queued',
    workflowInstanceId
  };
}

/**
 * Async document processing - runs in background
 * @param convexDocId - The Convex document _id (for mutations)
 * @param externalId - The external/custom ID (for logging)
 * @param contentType - The content type ('text' | 'url' | 'file')
 * @param containerTags - Container tags for scoping memories
 */
async function processDocumentAsync(
  userId: string,
  convexDocId: string,
  externalId: string,
  content: string,
  entityContext?: string,
  metadata: Record<string, any> = {},
  contentType: string = 'text',
  containerTags?: string[]
): Promise<void> {
  const client = getConvex();

  try {
    // Stage 1: Extracting (includes URL fetching if needed)
    await updateDocumentStatus(client, convexDocId, 'extracting');

    // Check if content is a URL that needs to be fetched
    let processedContent = content;
    let fetchedTitle: string | undefined;
    let fetchedMetadata: Record<string, any> = {};

    const shouldFetch = contentType === 'url' || UrlFetchService.shouldAutoFetch(content, contentType);

    if (shouldFetch) {
      console.log(`[Ingest] Fetching URL content for ${externalId}: ${content.substring(0, 100)}...`);

      const fetchResult = await UrlFetchService.fetchUrl(content.trim());

      if (fetchResult.success) {
        processedContent = fetchResult.content;
        fetchedTitle = fetchResult.title;
        fetchedMetadata = {
          sourceUrl: fetchResult.url,
          originalUrl: fetchResult.originalUrl,
          urlContentType: fetchResult.contentType,
          ...fetchResult.metadata,
        };

        // Update document with fetched content
        await client.mutation('content:update' as any, {
          id: convexDocId,
          content: processedContent,
          metadata: { ...metadata, ...fetchedMetadata },
        });

        console.log(`[Ingest] URL fetched successfully: ${fetchResult.contentType}, ${processedContent.length} chars`);
      } else {
        // URL fetch failed - log warning but continue with original content
        console.warn(`[Ingest] URL fetch failed for ${externalId}: ${fetchResult.error}`);
        fetchedMetadata = {
          urlFetchError: fetchResult.error,
          originalUrl: content.trim(),
        };
      }
    }

    // Extract memories, title, summary from the processed content
    const extraction: ExtractionResult = await extractMemories(processedContent, entityContext);

    // If no title was generated, use fetched title or generate one
    let title = extraction.title;
    if (!title && fetchedTitle) {
      title = fetchedTitle;
    }
    if (!title) {
      title = await generateTitle(processedContent);
    }

    // If no summary, generate one
    let summary = extraction.summary;
    if (!summary || summary.length < 20) {
      summary = await generateSummary(processedContent);
    }

    // Stage 2: Chunking
    await updateDocumentStatus(client, convexDocId, 'chunking');

    const chunks = processedContent.length > 500 ? chunkText(processedContent) : [processedContent];

    // Stage 3: Embedding
    await updateDocumentStatus(client, convexDocId, 'embedding');

    // Generate embeddings for document, chunks, and memories
    const allTexts = [
      processedContent.substring(0, 2000),  // Document embedding
      ...chunks,                             // Chunk embeddings
      ...extraction.memories.map(m => m.content)  // Memory embeddings
    ];

    const embeddings = await embedBatch(allTexts);
    const docEmbedding = embeddings[0];
    const chunkEmbeddings = embeddings.slice(1, 1 + chunks.length);
    const memoryEmbeddings = embeddings.slice(1 + chunks.length);

    // Stage 4: Indexing
    await updateDocumentStatus(client, convexDocId, 'indexing');

    // Update document with title, summary, embedding (use Convex _id)
    await client.mutation('content:update' as any, {
      id: convexDocId,
      title,
      embedding: docEmbedding,
    });

    // Store chunks
    for (let i = 0; i < chunks.length; i++) {
      try {
        await client.mutation('chunks:create' as any, {
          userId,
          documentId: convexDocId,
          content: chunks[i],
          chunkIndex: i,
          embedding: chunkEmbeddings[i],
          containerTags,  // Inherit from source document for scoping
        });
      } catch (e) {
        console.warn(`Failed to store chunk ${i}:`, e);
      }
    }

    // Store memories and process relationships
    const now = Date.now();
    const createdMemoryIds: string[] = [];

    for (let i = 0; i < extraction.memories.length; i++) {
      const mem = extraction.memories[i];
      console.log(`   💾 Saving memory ${i}: "${mem.content}"`);
      try {
        const memoryId = await client.mutation('memories:create' as any, {
          userId,
          content: mem.content,
          isCore: mem.isStatic,  // Map isStatic to isCore (static = core in our schema)
          sourceDocument: convexDocId,
          containerTags,  // Inherit from source document for scoping
          embedding: memoryEmbeddings[i],
          // Auto-forgetting fields
          memoryKind: mem.kind,  // 'fact' | 'preference' | 'event'
          expiresAt: mem.expiresAt,  // Unix timestamp for time-sensitive content
        });
        console.log(`   💾 Memory ${i} result: ${memoryId ? 'created/deduped' : 'null'}`);
        if (memoryId) {
          createdMemoryIds.push(memoryId);
        }
      } catch (e) {
        console.warn(`Failed to store memory ${i}:`, e);
      }
    }

    // Process memory relationships (async, non-blocking)
    for (let i = 0; i < createdMemoryIds.length; i++) {
      const memoryId = createdMemoryIds[i];
      const memoryContent = extraction.memories[i]?.content;
      if (memoryId && memoryContent) {
        // Process relationships in background (don't await)
        processNewMemory(userId, memoryId as any, memoryContent).catch((e) => {
          console.warn(`Failed to process memory relations for ${memoryId}:`, e);
        });
      }
    }

    // Stage 5: Done
    await updateDocumentStatus(client, convexDocId, 'done');

    const urlInfo = shouldFetch ? ` (URL fetched: ${fetchedMetadata.urlContentType || 'unknown'})` : '';
    console.log(`[Ingest] Document ${externalId} processed: ${extraction.memories.length} memories, ${chunks.length} chunks${urlInfo}`);
  } catch (error: any) {
    console.error(`Document processing failed for ${externalId}:`, error);
    await updateDocumentStatus(client, convexDocId, 'failed');
  }
}

/**
 * Update document status using Convex _id
 */
async function updateDocumentStatus(
  client: ConvexHttpClient,
  convexDocId: string,
  status: DocumentStatus
): Promise<void> {
  try {
    await client.mutation('content:updateStatus' as any, {
      id: convexDocId,
      status,
    });
  } catch (e) {
    // Ignore status update failures
    console.warn(`Failed to update status to ${status}:`, e);
  }
}

/**
 * Update document - Supermemory-compatible
 * Re-queues document for processing
 */
export async function updateDocument(
  userId: string,
  documentId: string,
  content: string,
  metadata?: Record<string, any>,
  contentType: string = 'text'
): Promise<IngestResponse> {
  const workflowInstanceId = generateWorkflowId();
  const client = getConvex();

  // Update document content and re-queue
  await client.mutation('content:update' as any, {
    user_id: userId,
    document_id: documentId,
    content,
    status: 'queued',
    metadata: metadata || {},
    updated_at: Date.now()
  });

  // Process async - detect contentType from content if URL
  const effectiveContentType = UrlFetchService.shouldAutoFetch(content) ? 'url' : contentType;

  processDocumentAsync(userId, documentId, documentId, content, undefined, metadata || {}, effectiveContentType).catch(err => {
    console.error(`Background processing failed for ${documentId}:`, err);
  });

  return {
    id: documentId,
    status: 'queued',
    workflowInstanceId
  };
}

/**
 * Get document by ID
 */
export async function getDocument(userId: string, documentId: string): Promise<DocumentInfo | null> {
  const client = getConvex();

  try {
    const doc = await client.query('content:getById' as any, {
      user_id: userId,
      document_id: documentId
    });

    if (!doc) return null;

    return {
      id: doc.custom_id || doc._id,
      customId: doc.custom_id,
      containerTags: [userId],
      createdAt: new Date(doc.created_at).toISOString(),
      updatedAt: new Date(doc.updated_at).toISOString(),
      title: doc.title,
      summary: doc.summary,
      type: doc.content_type || 'text',
      status: doc.status,
      metadata: doc.metadata || {}
    };
  } catch (e) {
    return null;
  }
}

/**
 * List documents - Supermemory-compatible response format
 */
export async function listDocuments(
  userId: string,
  options: { limit?: number; page?: number } = {}
): Promise<{ memories: DocumentInfo[]; pagination: any }> {
  const { limit = 10, page = 1 } = options;
  const client = getConvex();

  try {
    const docs = await client.query('content:listByUser' as any, {
      user_id: userId,
      limit,
      offset: (page - 1) * limit
    });

    const total = await client.query('content:countByUser' as any, { user_id: userId });

    return {
      memories: docs.map((doc: any) => ({
        id: doc.custom_id || doc._id,
        customId: doc.custom_id,
        containerTags: [userId],
        createdAt: new Date(doc.created_at).toISOString(),
        updatedAt: new Date(doc.updated_at).toISOString(),
        title: doc.title,
        summary: doc.summary,
        type: doc.content_type || 'text',
        status: doc.status,
        metadata: doc.metadata || {},
        connectionId: null
      })),
      pagination: {
        currentPage: page,
        limit,
        totalItems: total || 0,
        totalPages: Math.ceil((total || 0) / limit)
      }
    };
  } catch (e) {
    return { memories: [], pagination: { currentPage: 1, limit, totalItems: 0, totalPages: 0 } };
  }
}

/**
 * Delete document
 */
export async function deleteDocument(userId: string, documentId: string): Promise<boolean> {
  const client = getConvex();

  try {
    // Delete chunks
    await client.mutation('chunks:deleteByDocument' as any, {
      user_id: userId,
      document_id: documentId
    });

    // Delete memories from this document
    await client.mutation('memories:deleteByDocument' as any, {
      user_id: userId,
      source_document: documentId
    });

    // Delete document
    await client.mutation('content:delete' as any, {
      user_id: userId,
      document_id: documentId
    });

    return true;
  } catch (e) {
    console.error('Delete failed:', e);
    return false;
  }
}

/**
 * Bulk delete documents
 */
export async function bulkDeleteDocuments(
  userId: string,
  options: { ids?: string[]; containerTags?: string[] }
): Promise<{ deleted: number }> {
  const client = getConvex();
  let deleted = 0;

  if (options.ids) {
    for (const id of options.ids) {
      if (await deleteDocument(userId, id)) {
        deleted++;
      }
    }
  }

  return { deleted };
}

export const IngestService = {
  ingestContent,
  updateDocument,
  getDocument,
  listDocuments,
  deleteDocument,
  bulkDeleteDocuments
};
