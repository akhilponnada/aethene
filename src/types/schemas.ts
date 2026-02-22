/**
 * Zod Validation Schemas for Aethene API
 *
 * Centralized request/response validation
 */

import { z } from 'zod';

// =============================================================================
// COMMON SCHEMAS
// =============================================================================

export const PaginationSchema = z.object({
  limit: z.coerce.number().min(1).max(100).optional().default(50),
  offset: z.coerce.number().min(0).optional().default(0),
});

export const IdParamSchema = z.object({
  id: z.string().min(1, 'ID is required'),
});

// =============================================================================
// MEMORY SCHEMAS
// =============================================================================

export const CreateMemorySchema = z.object({
  content: z.string().min(1, 'Content is required').max(50000),
  isCore: z.boolean().optional().default(false),
  metadata: z.record(z.unknown()).optional(),
});

export const CreateMemoriesSchema = z.object({
  memories: z.array(CreateMemorySchema).min(1, 'At least one memory is required'),
  userId: z.string().max(200).optional(),  // Override auth userId (like Supermemory)
  containerTag: z.string().max(200).optional(),  // Alternative to userId
});

export const UpdateMemorySchema = z.object({
  content: z.string().min(1, 'Content is required').max(50000),
  isCore: z.boolean().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const ListMemoriesQuerySchema = z.object({
  limit: z.coerce.number().min(1).max(100).optional().default(50),
  isCore: z.enum(['true', 'false']).optional(),
  includeDeleted: z.enum(['true', 'false']).optional(),
  userId: z.string().max(100).optional(),  // Override auth userId
});

export const BatchForgetSchema = z.object({
  ids: z.array(z.string()).min(1, 'At least one ID is required').max(100),
});

export const RestoreMemorySchema = z.object({
  id: z.string().min(1, 'Memory ID is required'),
});

export const PromoteDemoteSchema = z.object({
  id: z.string().min(1, 'Memory ID is required'),
});

export const SetExpirySchema = z.object({
  // Absolute expiration time (ISO string or unix timestamp)
  expiresAt: z.union([z.string(), z.number()]).nullable().optional(),
  // Relative expiration time: "1h", "2d", "1w", "1m"
  expiresIn: z.string().regex(/^\d+[hdwm]$/i, 'Use format like "1h", "2d", "1w", or "1m"').optional(),
});

export const GetExpiringMemoriesQuerySchema = z.object({
  hours: z.coerce.number().min(1).max(168).optional().default(24),
  limit: z.coerce.number().min(1).max(100).optional().default(50),
});

export const GetByKindQuerySchema = z.object({
  limit: z.coerce.number().min(1).max(100).optional().default(50),
  includeExpired: z.enum(['true', 'false']).optional().default('false'),
});

// =============================================================================
// CONTENT SCHEMAS
// =============================================================================

export const IngestContentSchema = z.object({
  content: z.string().min(1, 'Content is required').max(100000),
  contentType: z.enum(['text', 'url', 'markdown', 'html']).optional().default('text'),
  title: z.string().max(500).optional(),
  customId: z.string().max(100).optional(),
  metadata: z.record(z.unknown()).optional(),
  async: z.boolean().optional().default(true),
  // User identification (like Supermemory's containerTag)
  containerTag: z.string().max(100).optional(),
  userId: z.string().max(100).optional(),
});

export const UpdateContentSchema = z.object({
  content: z.string().min(1).max(100000).optional(),
  title: z.string().max(500).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const BulkDeleteSchema = z.object({
  ids: z.array(z.string()).min(1, 'At least one ID is required').max(100),
});

export const ListContentQuerySchema = z.object({
  limit: z.coerce.number().min(1).max(100).optional().default(50),
  offset: z.coerce.number().min(0).optional().default(0),
  status: z.enum(['queued', 'extracting', 'chunking', 'embedding', 'indexing', 'done', 'failed']).optional(),
});

// =============================================================================
// METADATA FILTER SCHEMAS (Supermemory-compatible)
// =============================================================================

/**
 * Filter types matching Supermemory's API:
 * - string_equal: Exact string match (default when filterType not specified)
 * - string_contains: Substring match
 * - numeric: Numeric comparison with numericOperator
 * - array_contains: Check if array field contains value
 */
export const FilterTypeSchema = z.enum([
  'string_equal',
  'string_contains',
  'numeric',
  'array_contains'
]).optional();

/**
 * Numeric operators for filterType: 'numeric'
 */
export const NumericOperatorSchema = z.enum(['=', '!=', '>', '>=', '<', '<=']).optional();

/**
 * Single filter condition - Supermemory compatible
 *
 * Examples:
 * - { key: "status", value: "published" } - string equality (default)
 * - { filterType: "string_contains", key: "title", value: "react" } - substring
 * - { filterType: "numeric", key: "priority", value: "5", numericOperator: ">=" }
 * - { filterType: "array_contains", key: "tags", value: "important" }
 * - { key: "status", value: "draft", negate: true } - exclude matches
 */
export const FilterConditionSchema = z.object({
  // Required fields
  key: z.string().min(1).max(100),
  value: z.union([z.string(), z.number(), z.boolean()]),

  // Optional filter type (defaults to string_equal)
  filterType: FilterTypeSchema,

  // For numeric comparisons
  numericOperator: NumericOperatorSchema,

  // Case-insensitive matching for string operations
  ignoreCase: z.boolean().optional(),

  // Negate the condition (exclude matches)
  negate: z.boolean().optional(),
});

/**
 * Compound filter with AND/OR logic - Supermemory compatible
 *
 * Examples:
 * - { AND: [{ key: "type", value: "meeting" }, { key: "year", value: "2024" }] }
 * - { OR: [{ key: "team", value: "eng" }, { key: "team", value: "product" }] }
 * - Complex: { AND: [{ key: "type", value: "meeting" }, { OR: [...] }] }
 */
export const MetadataFilterSchema: z.ZodType<{
  AND?: Array<z.infer<typeof FilterConditionSchema> | { AND?: any[]; OR?: any[] }>;
  OR?: Array<z.infer<typeof FilterConditionSchema> | { AND?: any[]; OR?: any[] }>;
}> = z.object({
  AND: z.array(z.union([
    FilterConditionSchema,
    z.lazy(() => MetadataFilterSchema)
  ])).optional(),
  OR: z.array(z.union([
    FilterConditionSchema,
    z.lazy(() => MetadataFilterSchema)
  ])).optional(),
});

// =============================================================================
// SEARCH SCHEMAS
// =============================================================================

export const SearchSchema = z.object({
  query: z.string().min(1, 'Query is required').max(2000),
  limit: z.number().min(1).max(50).optional().default(10),
  mode: z.enum(['memories', 'documents', 'hybrid']).optional().default('hybrid'),
  rerank: z.boolean().optional().default(false),
  expandQuery: z.boolean().optional().default(false),
  threshold: z.number().min(0).max(1).optional().default(0),
  // Version handling: by default only returns latest versions (is_latest=true)
  // Set to true to include superseded/old versions in results
  includeHistory: z.boolean().optional().default(false),
  // User identification (like Supermemory's containerTag)
  containerTag: z.string().max(100).optional(),
  userId: z.string().max(100).optional(),
  // Legacy simple filters (backwards compatible)
  filters: z.union([
    // New Supermemory-compatible metadata filters
    MetadataFilterSchema,
    // Legacy simple filter format
    z.object({
      categories: z.array(z.string()).optional(),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
      isCore: z.boolean().optional(),
    })
  ]).optional(),
});

export const RecallSchema = z.object({
  query: z.string().min(1, 'Query is required').max(2000),
  limit: z.number().min(1).max(50).optional().default(10),
  includeContent: z.boolean().optional().default(false),
  includeProfile: z.boolean().optional().default(true),
  expandQuery: z.boolean().optional().default(true),
  rerank: z.boolean().optional().default(false),
  threshold: z.number().min(0).max(1).optional().default(0.3),
  // User identification (like Supermemory's containerTag)
  containerTag: z.string().max(100).optional(),
  userId: z.string().max(100).optional(),
});

// =============================================================================
// PROFILE SCHEMAS
// =============================================================================

export const ProfileQuerySchema = z.object({
  q: z.string().max(2000).optional(),
  includeRecent: z.enum(['true', 'false']).optional().default('true'),
  threshold: z.coerce.number().min(0).max(1).optional().default(0.5),
  // User identification (like Supermemory's containerTag)
  containerTag: z.string().max(100).optional(),
  userId: z.string().max(100).optional(),
});

export const ProfileSearchSchema = z.object({
  query: z.string().min(1, 'Query is required').max(2000),
  limit: z.number().min(1).max(50).optional().default(10),
  threshold: z.number().min(0).max(1).optional().default(0.5),
});

// =============================================================================
// CONTEXT SCHEMAS
// =============================================================================

export const ContextSchema = z.object({
  query: z.string().max(2000).optional(),
  includeRecent: z.boolean().optional().default(true),
  limit: z.number().min(1).max(50).optional().default(20),
});

// =============================================================================
// TYPE EXPORTS
// =============================================================================

export type CreateMemory = z.infer<typeof CreateMemorySchema>;
export type CreateMemories = z.infer<typeof CreateMemoriesSchema>;
export type UpdateMemory = z.infer<typeof UpdateMemorySchema>;
export type ListMemoriesQuery = z.infer<typeof ListMemoriesQuerySchema>;
export type BatchForget = z.infer<typeof BatchForgetSchema>;
export type RestoreMemory = z.infer<typeof RestoreMemorySchema>;
export type PromoteDemote = z.infer<typeof PromoteDemoteSchema>;
export type SetExpiry = z.infer<typeof SetExpirySchema>;
export type GetExpiringMemoriesQuery = z.infer<typeof GetExpiringMemoriesQuerySchema>;
export type GetByKindQuery = z.infer<typeof GetByKindQuerySchema>;

export type IngestContent = z.infer<typeof IngestContentSchema>;
export type UpdateContent = z.infer<typeof UpdateContentSchema>;
export type BulkDelete = z.infer<typeof BulkDeleteSchema>;
export type ListContentQuery = z.infer<typeof ListContentQuerySchema>;

export type SearchRequest = z.infer<typeof SearchSchema>;
export type RecallRequest = z.infer<typeof RecallSchema>;

export type ProfileQuery = z.infer<typeof ProfileQuerySchema>;
export type ProfileSearch = z.infer<typeof ProfileSearchSchema>;

export type ContextRequest = z.infer<typeof ContextSchema>;

// Metadata filter types
export type FilterType = z.infer<typeof FilterTypeSchema>;
export type NumericOperator = z.infer<typeof NumericOperatorSchema>;
export type FilterCondition = z.infer<typeof FilterConditionSchema>;
export type MetadataFilter = z.infer<typeof MetadataFilterSchema>;
