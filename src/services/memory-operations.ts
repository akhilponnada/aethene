/**
 * Memory Operations Service for Aethene
 *
 * Direct memory manipulation - create, forget, update with versioning.
 * Bypasses extraction pipeline for controlled memory storage.
 */

import { mutateConvex, queryConvex } from '../database/db.js';
import { embedText, embedBatch } from '../vector/embeddings.js';

// =============================================================================
// TYPES
// =============================================================================

export interface DirectMemoryInput {
  content: string;
  isCore?: boolean;  // true = permanent/static, false = dynamic/recent
  metadata?: Record<string, unknown>;
}

export interface CreatedMemory {
  id: string;
  content: string;
  isCore: boolean;
  version: number;
  createdAt: number;
}

export interface CreateMemoriesResult {
  documentId: string | null;
  memories: CreatedMemory[];
  errors: Array<{ index: number; error: string }>;
}

export interface UpdateMemoryResult {
  oldVersion: string;
  newVersion: string;
  versionNumber: number;
}

// =============================================================================
// VALIDATION
// =============================================================================

const MAX_CONTENT_LENGTH = 10000;
const METADATA_KEY_REGEX = /^[a-zA-Z0-9_-]+$/;

/**
 * Validate memory content
 */
function validateContent(content: string): { valid: boolean; error?: string } {
  if (!content || typeof content !== 'string') {
    return { valid: false, error: 'Content is required and must be a string' };
  }

  const trimmed = content.trim();
  if (trimmed.length === 0) {
    return { valid: false, error: 'Content cannot be empty' };
  }

  if (trimmed.length > MAX_CONTENT_LENGTH) {
    return { valid: false, error: `Content exceeds maximum length of ${MAX_CONTENT_LENGTH} characters` };
  }

  return { valid: true };
}

/**
 * Sanitize metadata keys (alphanumeric, underscore, hyphen only)
 */
function sanitizeMetadata(metadata: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!metadata || typeof metadata !== 'object') {
    return undefined;
  }

  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(metadata)) {
    // Validate key format
    if (!METADATA_KEY_REGEX.test(key)) {
      console.warn(`[MemoryOps] Skipping invalid metadata key: ${key}`);
      continue;
    }

    // Skip functions and undefined values
    if (typeof value === 'function' || value === undefined) {
      continue;
    }

    sanitized[key] = value;
  }

  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

// =============================================================================
// CREATE MEMORIES DIRECTLY
// =============================================================================

/**
 * Create memories directly, bypassing the extraction pipeline.
 *
 * @param userId - User ID
 * @param memories - Array of memory inputs
 * @returns Created memories with IDs
 */
export async function createMemoriesDirect(
  userId: string,
  memories: DirectMemoryInput[]
): Promise<CreateMemoriesResult> {
  if (!userId) {
    throw new Error('userId is required');
  }

  if (!memories || !Array.isArray(memories) || memories.length === 0) {
    throw new Error('memories array is required and cannot be empty');
  }

  // Rate limit bulk operations
  if (memories.length > 100) {
    throw new Error('Maximum 100 memories per request');
  }

  const createdMemories: CreatedMemory[] = [];
  const errors: Array<{ index: number; error: string }> = [];

  // Validate all content first
  const validMemories: Array<{ index: number; input: DirectMemoryInput; content: string }> = [];

  for (let i = 0; i < memories.length; i++) {
    const input = memories[i];
    const validation = validateContent(input.content);

    if (!validation.valid) {
      errors.push({ index: i, error: validation.error! });
      continue;
    }

    validMemories.push({
      index: i,
      input,
      content: input.content.trim()
    });
  }

  if (validMemories.length === 0) {
    return { documentId: null, memories: [], errors };
  }

  // Generate embeddings in batch for efficiency
  const contents = validMemories.map(m => m.content);
  let embeddings: number[][];

  try {
    embeddings = await embedBatch(contents);
  } catch (error: any) {
    console.error('[MemoryOps] Batch embedding failed:', error.message);
    // Fallback to sequential
    embeddings = [];
    for (const content of contents) {
      try {
        embeddings.push(await embedText(content));
      } catch (e) {
        embeddings.push([]);
      }
    }
  }

  // Create memories in database
  const now = Date.now();

  for (let i = 0; i < validMemories.length; i++) {
    const { index, input, content } = validMemories[i];
    const embedding = embeddings[i] || [];
    const sanitizedMetadata = sanitizeMetadata(input.metadata);

    try {
      const id = await mutateConvex<string>('memories:create', {
        userId,
        content,
        isCore: input.isCore ?? false,
        metadata: sanitizedMetadata,
        embedding,
      });

      if (id) {
        createdMemories.push({
          id,
          content,
          isCore: input.isCore ?? false,
          version: 1,
          createdAt: now,
        });
      } else {
        errors.push({ index, error: 'Failed to create memory' });
      }
    } catch (error: any) {
      errors.push({ index, error: error.message });
    }
  }

  // Create a tracking document for this batch (optional)
  let documentId: string | null = null;
  if (createdMemories.length > 0) {
    try {
      documentId = await mutateConvex<string>('content:create', {
        userId,
        content: `Direct memory batch: ${createdMemories.length} memories`,
        contentType: 'memory_batch',
        title: `Memory batch ${new Date().toISOString()}`,
        metadata: {
          memoryIds: createdMemories.map(m => m.id),
          type: 'direct_create',
        },
      });
    } catch (error) {
      // Non-critical, continue without document
      console.warn('[MemoryOps] Failed to create tracking document');
    }
  }

  return { documentId, memories: createdMemories, errors };
}

// =============================================================================
// FORGET MEMORY (SOFT DELETE)
// =============================================================================

/**
 * Forget a memory (soft delete for GDPR compliance).
 * Memory is excluded from search but preserved in database.
 *
 * @param userId - User ID (for ownership verification)
 * @param memoryId - Memory ID to forget
 */
export async function forgetMemory(userId: string, memoryId: string): Promise<void> {
  if (!userId) {
    throw new Error('userId is required');
  }

  if (!memoryId) {
    throw new Error('memoryId is required');
  }

  // Verify ownership
  const memory = await queryConvex<{ user_id: string; is_forgotten: boolean }>('memories:get', {
    id: memoryId,
  });

  if (!memory) {
    throw new Error('Memory not found');
  }

  if (memory.user_id !== userId) {
    throw new Error('Access denied: you do not own this memory');
  }

  if (memory.is_forgotten) {
    // Already forgotten, no-op
    return;
  }

  // Soft delete
  const result = await mutateConvex('memories:forget', { id: memoryId });

  if (!result) {
    throw new Error('Failed to forget memory');
  }
}

/**
 * Restore a forgotten memory.
 *
 * @param userId - User ID (for ownership verification)
 * @param memoryId - Memory ID to restore
 */
export async function restoreMemory(userId: string, memoryId: string): Promise<void> {
  if (!userId) {
    throw new Error('userId is required');
  }

  if (!memoryId) {
    throw new Error('memoryId is required');
  }

  // Verify ownership
  const memory = await queryConvex<{ user_id: string; is_forgotten: boolean }>('memories:get', {
    id: memoryId,
  });

  if (!memory) {
    throw new Error('Memory not found');
  }

  if (memory.user_id !== userId) {
    throw new Error('Access denied: you do not own this memory');
  }

  if (!memory.is_forgotten) {
    // Not forgotten, no-op
    return;
  }

  // Restore
  const result = await mutateConvex('memoryOps:restore', { id: memoryId });

  if (!result) {
    throw new Error('Failed to restore memory');
  }
}

// =============================================================================
// UPDATE MEMORY (VERSIONED)
// =============================================================================

/**
 * Update a memory, creating a new version.
 * Old version is marked as is_latest=false and linked.
 *
 * @param userId - User ID (for ownership verification)
 * @param memoryId - Memory ID to update
 * @param newContent - New content for the memory
 * @param metadata - Optional new metadata
 * @returns Version information
 */
export async function updateMemory(
  userId: string,
  memoryId: string,
  newContent: string,
  metadata?: Record<string, unknown>
): Promise<UpdateMemoryResult> {
  if (!userId) {
    throw new Error('userId is required');
  }

  if (!memoryId) {
    throw new Error('memoryId is required');
  }

  // Validate content
  const validation = validateContent(newContent);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  const content = newContent.trim();

  // Verify ownership and get existing memory
  const memory = await queryConvex<{
    user_id: string;
    version: number;
    is_forgotten: boolean;
    is_latest: boolean;
    content: string;
  }>('memories:get', { id: memoryId });

  if (!memory) {
    throw new Error('Memory not found');
  }

  if (memory.user_id !== userId) {
    throw new Error('Access denied: you do not own this memory');
  }

  if (memory.is_forgotten) {
    throw new Error('Cannot update a forgotten memory. Restore it first.');
  }

  // Check if content actually changed
  if (memory.content === content) {
    throw new Error('New content is identical to existing content');
  }

  // Generate embedding for new content
  const embedding = await embedText(content);

  // Sanitize metadata
  const sanitizedMetadata = sanitizeMetadata(metadata);

  // Create new version (marks old as superseded)
  const newId = await mutateConvex<string>('memories:update', {
    id: memoryId,
    content,
    metadata: sanitizedMetadata,
    embedding,
  });

  if (!newId) {
    throw new Error('Failed to create new memory version');
  }

  const newVersion = (memory.version || 1) + 1;

  return {
    oldVersion: memoryId,
    newVersion: newId,
    versionNumber: newVersion,
  };
}

// =============================================================================
// BATCH FORGET
// =============================================================================

/**
 * Forget multiple memories at once.
 *
 * @param userId - User ID
 * @param memoryIds - Array of memory IDs to forget
 * @returns Results for each memory
 */
export async function batchForget(
  userId: string,
  memoryIds: string[]
): Promise<{ forgotten: string[]; errors: Array<{ id: string; error: string }> }> {
  if (!userId) {
    throw new Error('userId is required');
  }

  if (!memoryIds || !Array.isArray(memoryIds) || memoryIds.length === 0) {
    throw new Error('memoryIds array is required and cannot be empty');
  }

  // Rate limit
  if (memoryIds.length > 100) {
    throw new Error('Maximum 100 memories per batch forget request');
  }

  const forgotten: string[] = [];
  const errors: Array<{ id: string; error: string }> = [];

  for (const memoryId of memoryIds) {
    try {
      await forgetMemory(userId, memoryId);
      forgotten.push(memoryId);
    } catch (error: any) {
      errors.push({ id: memoryId, error: error.message });
    }
  }

  return { forgotten, errors };
}

// =============================================================================
// GET MEMORY VERSION HISTORY
// =============================================================================

/**
 * Get the version history of a memory.
 *
 * @param userId - User ID
 * @param memoryId - Memory ID
 * @returns Array of memory versions (newest first)
 */
export async function getVersionHistory(
  userId: string,
  memoryId: string
): Promise<Array<{
  id: string;
  content: string;
  version: number;
  createdAt: number;
  isLatest: boolean;
}>> {
  if (!userId) {
    throw new Error('userId is required');
  }

  if (!memoryId) {
    throw new Error('memoryId is required');
  }

  // Verify ownership first
  const memory = await queryConvex<{ user_id: string }>('memories:get', { id: memoryId });

  if (!memory) {
    throw new Error('Memory not found');
  }

  if (memory.user_id !== userId) {
    throw new Error('Access denied: you do not own this memory');
  }

  // Get version history
  const history = await queryConvex<Array<{
    _id: string;
    content: string;
    version: number;
    created_at: number;
    is_latest: boolean;
  }>>('memories:getVersionHistory', { id: memoryId });

  if (!history) {
    return [];
  }

  return history.map(m => ({
    id: m._id,
    content: m.content,
    version: m.version,
    createdAt: m.created_at,
    isLatest: m.is_latest,
  }));
}

// =============================================================================
// PROMOTE / DEMOTE CORE STATUS
// =============================================================================

/**
 * Promote a memory to core (permanent) status.
 *
 * @param userId - User ID
 * @param memoryId - Memory ID
 */
export async function promoteToCore(userId: string, memoryId: string): Promise<void> {
  if (!userId || !memoryId) {
    throw new Error('userId and memoryId are required');
  }

  // Verify ownership
  const memory = await queryConvex<{ user_id: string; is_core: boolean }>('memories:get', {
    id: memoryId,
  });

  if (!memory) {
    throw new Error('Memory not found');
  }

  if (memory.user_id !== userId) {
    throw new Error('Access denied: you do not own this memory');
  }

  if (memory.is_core) {
    return; // Already core
  }

  await mutateConvex('memories:promoteToCore', { id: memoryId });
}

/**
 * Demote a memory from core (permanent) to dynamic status.
 *
 * @param userId - User ID
 * @param memoryId - Memory ID
 */
export async function demoteFromCore(userId: string, memoryId: string): Promise<void> {
  if (!userId || !memoryId) {
    throw new Error('userId and memoryId are required');
  }

  // Verify ownership
  const memory = await queryConvex<{ user_id: string; is_core: boolean }>('memories:get', {
    id: memoryId,
  });

  if (!memory) {
    throw new Error('Memory not found');
  }

  if (memory.user_id !== userId) {
    throw new Error('Access denied: you do not own this memory');
  }

  if (!memory.is_core) {
    return; // Already not core
  }

  await mutateConvex('memories:demoteFromCore', { id: memoryId });
}
