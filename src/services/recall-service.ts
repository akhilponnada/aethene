/**
 * Recall Service - Aethene-compatible search with advanced features
 *
 * v4/search response format:
 * {
 *   "results": [
 *     {
 *       "id": "...",
 *       "memory": "Sarah Johnson works as...",
 *       "rootMemoryId": "...",
 *       "metadata": null,
 *       "updatedAt": "2026-02-17T00:07:32.014Z",
 *       "version": 1,
 *       "similarity": 0.6746
 *     }
 *   ],
 *   "timing": 157,
 *   "total": 6
 * }
 *
 * Advanced Features:
 * - Query Expansion: Uses Gemini to expand short queries for better recall
 * - Smart Reranking: Cross-encoder style scoring using Gemini
 * - Advanced Filters: AND/OR filter logic with validation
 */

import { ConvexHttpClient } from 'convex/browser';
import { embedQuery } from '../vector/embeddings.js';
import { GoogleGenerativeAI } from '@google/generative-ai';

// =============================================================================
// EMBEDDING CACHE - Cache query embeddings for faster repeated searches
// =============================================================================
const embeddingCache = new Map<string, { embedding: number[]; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const MAX_CACHE_SIZE = 500;

async function getCachedEmbedding(query: string): Promise<number[]> {
  const cacheKey = query.toLowerCase().trim();
  const cached = embeddingCache.get(cacheKey);

  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.embedding;
  }

  // Use embedQuery for search queries (RETRIEVAL_QUERY task type) - faster & more accurate
  const embedding = await embedQuery(query);

  // Evict old entries if cache is full
  if (embeddingCache.size >= MAX_CACHE_SIZE) {
    const oldestKey = embeddingCache.keys().next().value;
    if (oldestKey) embeddingCache.delete(oldestKey);
  }

  embeddingCache.set(cacheKey, { embedding, timestamp: Date.now() });
  return embedding;
}

// Supermemory v4/search memory result
export interface MemoryResult {
  id: string;
  memory: string;
  rootMemoryId: string;
  metadata: any;
  updatedAt: string;
  version: number;
  similarity: number;
  // Filterable fields
  category?: string;
  type?: string;
  isStatic?: boolean;
  // Relationship fields
  isLatest?: boolean;
  supersededBy?: string;
  relationships?: Array<{
    type: string;  // UPDATES, EXTENDS, DERIVES
    relatedMemoryId: string;
    confidence: number;
    direction: 'outgoing' | 'incoming';
  }>;
  documents?: Array<{
    id: string;
    createdAt: string;
    updatedAt: string;
    title: string;
    type: string;
    metadata: any;
  }>;
}

// Supermemory v3/search document result
export interface DocumentResult {
  documentId: string;
  title: string;
  type: string;
  score: number;
  createdAt: string;
  updatedAt: string;
  metadata: any;
  chunks: Array<{
    content: string;
    position: number;
    isRelevant: boolean;
    score: number;
  }>;
}

export interface SearchResponse {
  results: MemoryResult[];
  timing: number;
  total: number;
}

export interface DocumentSearchResponse {
  results: DocumentResult[];
  timing: number;
  total: number;
}

export type SearchMode = 'memories' | 'hybrid' | 'documents';

// ============================================================================
// ADVANCED FILTER TYPES (Supermemory-compatible)
// ============================================================================

/**
 * Filter types matching Supermemory's API:
 * - string_equal: Exact string match (default)
 * - string_contains: Substring match
 * - numeric: Numeric comparison with numericOperator
 * - array_contains: Check if array field contains value
 */
export type FilterType = 'string_equal' | 'string_contains' | 'numeric' | 'array_contains';

/**
 * Numeric operators for filterType: 'numeric'
 */
export type NumericOperator = '=' | '!=' | '>' | '>=' | '<' | '<=';

/**
 * Filter condition - Supermemory compatible
 *
 * Examples:
 * - { key: "status", value: "published" } - string equality (default)
 * - { filterType: "string_contains", key: "title", value: "react" }
 * - { filterType: "numeric", key: "priority", value: "5", numericOperator: ">=" }
 * - { filterType: "array_contains", key: "tags", value: "important" }
 * - { key: "status", value: "draft", negate: true } - exclude matches
 */
export interface FilterCondition {
  key: string;
  value: string | number | boolean;
  filterType?: FilterType;
  numericOperator?: NumericOperator;
  ignoreCase?: boolean;
  negate?: boolean;
}

/**
 * Compound filter with AND/OR logic - Supermemory compatible
 * Supports nested AND/OR for complex queries
 */
export interface SearchFilter {
  AND?: Array<FilterCondition | SearchFilter>;
  OR?: Array<FilterCondition | SearchFilter>;
}

/**
 * Legacy filter condition (for backwards compatibility)
 */
export interface LegacyFilterCondition {
  field: string;
  operator: 'eq' | 'neq' | 'contains' | 'gt' | 'gte' | 'lt' | 'lte' | 'in';
  value: string | number | boolean;
  ignoreCase?: boolean;
  negate?: boolean;
}

/**
 * Extended search options with advanced features
 */
export interface AdvancedSearchOptions {
  limit?: number;
  searchMode?: SearchMode;
  rerank?: boolean;
  expandQuery?: boolean;
  threshold?: number;
  categories?: string[];
  filters?: SearchFilter;
  includeRelationships?: boolean;  // Include memory relationships in results
  includeHistory?: boolean;  // Include superseded versions (is_latest=false) - defaults to false
  containerTag?: string;  // Filter by containerTag at Convex level for efficiency
}

// ============================================================================
// VALID FILTER TYPES AND FIELDS (whitelist for security)
// ============================================================================

const VALID_FILTER_TYPES = new Set(['string_equal', 'string_contains', 'numeric', 'array_contains']);

const VALID_NUMERIC_OPERATORS = new Set(['=', '!=', '>', '>=', '<', '<=']);

const ALLOWED_FILTER_FIELDS = new Set([
  // Memory fields
  'memory', 'content', 'metadata', 'version', 'similarity', 'updatedAt',
  'createdAt', 'type', 'category', 'title', 'documentId', 'isCore', 'isStatic',
  // Common metadata fields
  'status', 'priority', 'tags', 'team', 'year', 'participants', 'description'
]);

// ============================================================================
// GEMINI CLIENT FOR QUERY EXPANSION AND RERANKING
// ============================================================================

let genAI: GoogleGenerativeAI | null = null;

function getGenAI(): GoogleGenerativeAI {
  if (!genAI) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is required');
    }
    genAI = new GoogleGenerativeAI(apiKey);
  }
  return genAI;
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

/**
 * Search memories - Aethene v4/search compatible with advanced features
 *
 * @param userId - User ID to search within
 * @param query - Search query
 * @param options - Advanced search options
 * @param options.limit - Maximum results (default: 10)
 * @param options.searchMode - 'memories' or 'hybrid' (default: 'hybrid')
 * @param options.rerank - Use Gemini for cross-encoder style reranking (adds ~100-200ms)
 * @param options.expandQuery - Use Gemini to expand short queries for better recall
 * @param options.threshold - Minimum similarity threshold (default: 0)
 * @param options.filters - Advanced filter with AND/OR logic
 */
export async function searchMemories(
  userId: string,
  query: string,
  options: AdvancedSearchOptions = {}
): Promise<SearchResponse> {
  const {
    limit = 10,
    searchMode = 'hybrid',
    rerank = false,
    expandQuery = false,
    threshold = 0,
    filters,
    includeRelationships = false,
    includeHistory = false,  // By default, only return latest versions
    containerTag  // Filter at Convex level for efficiency
  } = options;

  const startTime = Date.now();
  const client = getConvex();

  try {
    // Query expansion if requested
    let searchQuery = query;
    if (expandQuery && query.trim().length > 0) {
      searchQuery = await expandSearchQuery(query);
    }

    // Generate query embedding (with caching for faster repeated queries)
    const embedding = await getCachedEmbedding(searchQuery);

    // Extract metadata filters for server-side filtering in Convex
    const metadataFilters = filters ? extractMetadataFilters(filters) : undefined;

    // Run memory and chunk searches IN PARALLEL for faster results
    const memorySearchPromise = vectorSearchMemories(client, userId, embedding, Math.min(limit * 2, 100), metadataFilters, containerTag);
    const chunkSearchPromise = searchMode === 'hybrid'
      ? vectorSearchChunks(client, userId, embedding, limit)
      : Promise.resolve([]);

    const [memorySearchResults, chunkResults] = await Promise.all([memorySearchPromise, chunkSearchPromise]);

    // Merge results
    let memoryResults = memorySearchResults;
    if (chunkResults.length > 0) {
      const chunkAsMemory = chunkResults.map(c => ({
        ...c,
        isFromChunk: true,
        isLatest: true
      }));
      memoryResults = [...memoryResults, ...chunkAsMemory];
    }

    // Apply threshold filter
    if (threshold > 0) {
      memoryResults = memoryResults.filter(r => r.similarity >= threshold);
    }

    // Apply advanced filters if provided
    if (filters) {
      // Convert legacy filters if needed
      const normalizedFilters = convertLegacyFilters(filters) || filters;
      memoryResults = applyFilters(memoryResults, normalizedFilters as SearchFilter);
    }

    // Filter out superseded versions unless includeHistory is true
    // This ensures old values don't appear alongside new values
    // CRITICAL: When is_latest=false, the memory has been explicitly superseded by a newer version
    if (!includeHistory) {
      memoryResults = memoryResults.filter(r => r.isLatest !== false);
    }

    // Apply ranking boosts/penalties to ensure correct ordering:
    // 1. Heavy penalty for is_latest=false (superseded memories)
    // 2. Strong recency boost for newer memories
    const now = Date.now();
    memoryResults = memoryResults.map(r => {
      let similarity = r.similarity;

      // PENALTY for superseded versions (is_latest=false)
      // Even if includeHistory=true, superseded memories should rank much lower
      // This ensures that if both old ($5M) and new ($10M) revenue targets appear,
      // the new one always ranks first
      if (r.isLatest === false) {
        similarity = similarity * 0.3;  // 70% penalty for superseded memories
      }
      // Boost for confirmed latest versions (is_latest=true explicitly set)
      else if (r.isLatest === true) {
        similarity = Math.min(1.0, similarity * 1.3);  // 30% boost for latest
      }

      // Recency boost: newer memories get up to 50% boost based on age
      // This ensures that when two memories both have is_latest=true (contradiction not detected),
      // the newer one ranks higher (e.g., $6.2M ranks above $5M for revenue target)
      // Also helps when contradiction detection misses edge cases
      const updatedAt = r.updatedAt ? new Date(r.updatedAt).getTime() : 0;
      if (updatedAt > 0) {
        // Calculate age in days (max 365 days for boost calculation)
        const ageInDays = Math.min(365, (now - updatedAt) / (1000 * 60 * 60 * 24));
        // Newer = higher boost: 1.50 for today, decaying to 1.0 for 365+ days old
        const recencyBoost = 1.0 + (0.50 * (1 - ageInDays / 365));
        similarity = Math.min(1.0, similarity * recencyBoost);
      }

      return { ...r, similarity };
    });

    // Deduplicate
    memoryResults = deduplicateResults(memoryResults);

    // Apply intent-based reranking for better query understanding
    // This handles cases like "where does X live" returning residence info over "parents live in..."
    if (memoryResults.length > 1) {
      memoryResults = intentBasedRerank(query, memoryResults);
    }

    // Sort by similarity (now includes is_latest boost + intent boost)
    memoryResults.sort((a, b) => b.similarity - a.similarity);

    // Apply smart reranking if requested (adds ~100-200ms latency)
    // This uses Gemini for cross-encoder style scoring on top of intent-based ranking
    if (rerank && memoryResults.length > 1) {
      memoryResults = await smartRerank(query, memoryResults);
    }

    // Limit results
    memoryResults = memoryResults.slice(0, limit);

    // Optionally include relationships for each result
    if (includeRelationships) {
      try {
        const { MemoryRelationsService, toSupermemoryLinkType } = await import('./memory-relations.js');

        memoryResults = await Promise.all(
          memoryResults.map(async (result) => {
            try {
              const memoryWithRels = await MemoryRelationsService.getMemoryWithRelationships(result.id as any);
              if (memoryWithRels) {
                return {
                  ...result,
                  isLatest: memoryWithRels.isLatest,
                  supersededBy: memoryWithRels.supersededBy,
                  relationships: memoryWithRels.relationships.map(r => ({
                    type: r.relationType,
                    relatedMemoryId: r.relatedMemoryId,
                    confidence: r.confidence,
                    direction: r.direction,
                  })),
                };
              }
            } catch (e) {
              // Ignore relationship lookup errors, return result as-is
            }
            return result;
          })
        );
      } catch (e) {
        console.warn('Failed to include relationships:', e);
      }
    }

    return {
      results: memoryResults,
      timing: Date.now() - startTime,
      total: memoryResults.length
    };
  } catch (error: any) {
    console.error('Search failed:', error);
    return {
      results: [],
      timing: Date.now() - startTime,
      total: 0
    };
  }
}

/**
 * Search documents - Supermemory v3/search compatible
 */
export async function searchDocuments(
  userId: string,
  query: string,
  options: {
    limit?: number;
    filters?: any;
    includeFullDocs?: boolean;
  } = {}
): Promise<DocumentSearchResponse> {
  const { limit = 10, includeFullDocs = false } = options;
  const startTime = Date.now();
  const client = getConvex();

  try {
    // Generate query embedding
    const embedding = await embedQuery(query);

    // Search chunks grouped by document
    const chunks = await vectorSearchChunks(client, userId, embedding, limit * 3);

    // Group chunks by document
    const docMap = new Map<string, DocumentResult>();

    for (const chunk of chunks) {
      const docId = chunk.documentId || 'unknown';

      if (!docMap.has(docId)) {
        docMap.set(docId, {
          documentId: docId,
          title: chunk.title || '',
          type: chunk.type || 'text',
          score: chunk.similarity,
          createdAt: chunk.createdAt,
          updatedAt: chunk.updatedAt,
          metadata: chunk.metadata || {},
          chunks: []
        });
      }

      const doc = docMap.get(docId)!;
      doc.chunks.push({
        content: chunk.memory,
        position: chunk.position || 0,
        isRelevant: true,
        score: chunk.similarity
      });

      // Update doc score to max chunk score
      if (chunk.similarity > doc.score) {
        doc.score = chunk.similarity;
      }
    }

    // Convert to array and sort
    let results = Array.from(docMap.values());
    results.sort((a, b) => b.score - a.score);
    results = results.slice(0, limit);

    return {
      results,
      timing: Date.now() - startTime,
      total: results.length
    };
  } catch (error: any) {
    console.error('Document search failed:', error);
    return {
      results: [],
      timing: Date.now() - startTime,
      total: 0
    };
  }
}

/**
 * Extract simple metadata filters from advanced filter format for Convex
 * Convex supports: category, type, isStatic
 */
function extractMetadataFilters(filters?: SearchFilter): { category?: string; type?: string; isStatic?: boolean } | undefined {
  if (!filters) return undefined;

  const result: { category?: string; type?: string; isStatic?: boolean } = {};

  // Helper to extract from a condition
  const extractFromCondition = (condition: FilterCondition) => {
    // Only extract string_equal filters without negation for server-side filtering
    if (condition.negate || (condition.filterType && condition.filterType !== 'string_equal')) {
      return;
    }
    if (condition.key === 'category' && typeof condition.value === 'string') {
      result.category = condition.value;
    }
    if (condition.key === 'type' && typeof condition.value === 'string') {
      result.type = condition.value;
    }
    if (condition.key === 'isStatic' && typeof condition.value === 'boolean') {
      result.isStatic = condition.value;
    }
  };

  // Process AND conditions - these can all be applied at Convex level
  if (filters.AND) {
    for (const item of filters.AND) {
      if (isFilterCondition(item)) {
        extractFromCondition(item);
      }
    }
  }

  // Process OR conditions - only use if single condition (can't OR at Convex level)
  if (filters.OR && filters.OR.length === 1) {
    const item = filters.OR[0];
    if (isFilterCondition(item)) {
      extractFromCondition(item);
    }
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * Vector search memories from Convex
 */
async function vectorSearchMemories(
  client: ConvexHttpClient,
  userId: string,
  embedding: number[],
  limit: number,
  metadataFilters?: { category?: string; type?: string; isStatic?: boolean },
  containerTag?: string  // Filter at Convex level for efficiency
): Promise<MemoryResult[]> {
  try {
    // Use client.action() for Convex actions (not queries)
    const results = await client.action('vectorSearch:searchMemories' as any, {
      userId,
      embedding,
      limit,
      minScore: 0.3,  // Lower threshold for better recall
      metadataFilters,  // Pass filters to Convex for server-side filtering
      containerTag,  // Filter by containerTag at Convex level
    });

    if (!results) return [];

    return results.map((r: any) => ({
      id: r._id,
      memory: r.content,
      rootMemoryId: r._id,
      metadata: r.metadata || null,
      updatedAt: new Date(r.updated_at || r.created_at).toISOString(),
      version: r.version || 1,
      similarity: r.score || 0,  // Fixed: Convex returns 'score', not '_score'
      // Include category/type in result for client-side filtering of complex filters
      category: r.category,
      type: r.type,
      isStatic: r.is_static,
      isLatest: r.is_latest,  // Include is_latest for version boosting
      containerTags: r.container_tags || [],  // Include for containerTag filtering
      documents: r.source_document ? [{
        id: r.source_document,
        createdAt: new Date(r.created_at).toISOString(),
        updatedAt: new Date(r.updated_at || r.created_at).toISOString(),
        title: '',
        type: 'text',
        metadata: {}
      }] : undefined
    }));
  } catch (error) {
    console.warn('Memory vector search failed:', error);
    return [];
  }
}

/**
 * Vector search chunks from Convex
 */
async function vectorSearchChunks(
  client: ConvexHttpClient,
  userId: string,
  embedding: number[],
  limit: number
): Promise<any[]> {
  try {
    // Use client.action() for Convex actions (not queries)
    const results = await client.action('vectorSearch:searchChunks' as any, {
      userId,
      embedding,
      limit,
      minScore: 0.3,
    });

    if (!results) return [];

    return results.map((r: any) => ({
      id: r._id,
      memory: r.content,
      rootMemoryId: r._id,
      documentId: r.document_id,
      title: r.document_title || '',
      type: 'text',
      metadata: null,
      createdAt: new Date(r.created_at).toISOString(),
      updatedAt: new Date(r.created_at).toISOString(),
      position: r.chunk_index || 0,
      similarity: r.score || 0,  // Fixed: Convex returns 'score', not '_score'
      containerTags: r.container_tags || [],  // Include containerTags for filtering
    }));
  } catch (error) {
    console.warn('Chunk vector search failed:', error);
    return [];
  }
}

/**
 * Deduplicate results by content
 */
function deduplicateResults(results: MemoryResult[]): MemoryResult[] {
  const seen = new Set<string>();
  const deduplicated: MemoryResult[] = [];

  for (const result of results) {
    const key = result.memory.toLowerCase().trim().substring(0, 100);
    if (!seen.has(key)) {
      seen.add(key);
      deduplicated.push(result);
    }
  }

  return deduplicated;
}

// ============================================================================
// QUERY EXPANSION
// ============================================================================

/**
 * Expand short queries using Gemini for better recall
 *
 * Examples:
 * - "auth issues" -> "authentication login oauth jwt security errors problems"
 * - "project deadline" -> "project deadline due date timeline schedule milestone"
 * - "meeting notes" -> "meeting notes summary discussion agenda action items"
 */
async function expandSearchQuery(query: string): Promise<string> {
  // Don't expand already long queries
  if (query.split(/\s+/).length > 5) {
    return query;
  }

  try {
    const model = getGenAI().getGenerativeModel({ model: 'gemini-2.0-flash' });

    const prompt = `Expand this search query with related terms and synonyms to improve search recall.
Keep it concise - add 3-6 relevant terms that someone might have used to describe the same concept.

Query: "${query}"

Return ONLY the expanded query, no explanations. Keep the original terms and add synonyms/related terms.
Example: "auth issues" -> "auth authentication login oauth jwt security errors issues problems"`;

    const result = await model.generateContent(prompt);
    const expanded = result.response.text()?.trim();

    if (expanded && expanded.length > 0 && expanded.length < 500) {
      return expanded;
    }
    return query;
  } catch (error) {
    console.warn('Query expansion failed, using original query:', error);
    return query;
  }
}

// ============================================================================
// SMART RERANKING
// ============================================================================

/**
 * Rerank results using Gemini for cross-encoder style scoring
 * Adds ~100-200ms latency but provides much better relevance
 *
 * This simulates a cross-encoder by having the LLM score each result's
 * relevance to the query, considering semantic meaning beyond keyword matching.
 */
async function smartRerank(
  query: string,
  results: MemoryResult[]
): Promise<MemoryResult[]> {
  if (results.length === 0) return results;

  // Limit to top 20 candidates for reranking to control latency
  const candidates = results.slice(0, 20);

  try {
    const model = getGenAI().getGenerativeModel({ model: 'gemini-2.0-flash' });

    // Build content list for scoring
    const contentList = candidates.map((r, i) => `[${i}]: ${r.memory.slice(0, 300)}`).join('\n');

    const prompt = `You are a search relevance scorer. Given a query and a list of results, score each result's relevance from 0.0 to 1.0.

Query: "${query}"

Results:
${contentList}

Scoring criteria:
- 1.0: Perfect match, directly answers the query
- 0.8-0.9: Highly relevant, contains key information
- 0.6-0.7: Somewhat relevant, related topic
- 0.4-0.5: Tangentially related
- 0.1-0.3: Barely relevant
- 0.0: Not relevant at all

Return ONLY a JSON array of scores in the same order, like: [0.9, 0.7, 0.3, ...]`;

    const result = await model.generateContent(prompt);
    const text = result.response.text()?.trim() || '';

    // Parse scores from response
    const jsonMatch = text.match(/\[[\d.,\s]+\]/);
    if (jsonMatch) {
      const scores: number[] = JSON.parse(jsonMatch[0]);

      if (scores.length === candidates.length) {
        // Apply Gemini scores, combining with original similarity
        const reranked = candidates.map((r, i) => ({
          ...r,
          // Weighted combination: 40% original similarity + 60% Gemini score
          similarity: Math.min(1.0, r.similarity * 0.4 + (scores[i] || 0) * 0.6)
        }));

        reranked.sort((a, b) => b.similarity - a.similarity);
        return reranked;
      }
    }

    // Fallback to keyword-based boost if parsing fails
    return keywordRerank(query, candidates);
  } catch (error) {
    console.warn('Smart reranking failed, using keyword fallback:', error);
    return keywordRerank(query, candidates);
  }
}

/**
 * Query intent patterns for better understanding
 * Maps question patterns to relevant content indicators
 */
const QUERY_INTENT_PATTERNS: Array<{
  pattern: RegExp;
  intentType: string;
  positiveIndicators: string[];
  negativeIndicators: string[];
  weight: number;
}> = [
  // Location/Residence queries - "where does X live", "where is X located"
  {
    pattern: /where\s+(does|did|is|was)\s+\w+\s*(live|reside|stay|located|based|living)/i,
    intentType: 'residence',
    positiveIndicators: ['lives in', 'resides in', 'moved to', 'bought', 'condo', 'apartment', 'house', 'home', 'address', 'relocated', 'living in', 'based in', 'stays in'],
    negativeIndicators: ['parents live', 'family lives', 'grew up in', 'born in', 'visited', 'traveled to', 'trip to'],
    weight: 0.35
  },
  // Work/Job queries - "where does X work", "what is X's job"
  {
    pattern: /where\s+(does|did)\s+\w+\s*work|what\s+(is|was)\s+\w+('s)?\s*(job|role|position|profession|occupation)/i,
    intentType: 'employment',
    positiveIndicators: ['works at', 'works as', 'employed at', 'job at', 'position at', 'role at', 'started at', 'joined'],
    negativeIndicators: ['previous job', 'used to work', 'left', 'quit'],
    weight: 0.30
  },
  // Education queries
  {
    pattern: /where\s+(did|does)\s+\w+\s*(go\s+to\s+school|study|graduate|attend|get\s+degree)|what\s+(is|was)\s+\w+('s)?\s*(degree|education|school|university|college)/i,
    intentType: 'education',
    positiveIndicators: ['graduated from', 'degree from', 'studied at', 'attended', 'mba', 'bachelor', 'master', 'phd', 'university', 'college', 'school'],
    negativeIndicators: [],
    weight: 0.25
  },
  // Diet/Food preferences
  {
    pattern: /what\s+(does|did)\s+\w+\s*eat|what\s+(is|was)\s+\w+('s)?\s*(diet|food preference)/i,
    intentType: 'diet',
    positiveIndicators: ['vegetarian', 'vegan', 'pescatarian', 'eats', 'diet', 'doesn\'t eat', 'allergic'],
    negativeIndicators: [],
    weight: 0.25
  },
  // Relationship queries - "who is X"
  {
    pattern: /who\s+(is|was)\s+\w+/i,
    intentType: 'relationship',
    positiveIndicators: ['is a', 'works as', 'friend', 'colleague', 'manager', 'partner', 'spouse', 'met at'],
    negativeIndicators: [],
    weight: 0.20
  },
  // Time/When queries
  {
    pattern: /when\s+(did|does|is|was|will)/i,
    intentType: 'temporal',
    positiveIndicators: ['in', 'on', 'at', 'during', 'ago', 'started', 'began', 'will', 'planning'],
    negativeIndicators: [],
    weight: 0.15
  },
  // Current state queries - "what is X doing", "how is X"
  {
    pattern: /what\s+(is|are)\s+\w+\s*(doing|working on|planning)|how\s+(is|are)\s+\w+/i,
    intentType: 'current_state',
    positiveIndicators: ['currently', 'now', 'working on', 'planning', 'doing'],
    negativeIndicators: ['used to', 'previously', 'before'],
    weight: 0.20
  },
];

/**
 * Extract the subject/entity from a query
 * e.g., "Where does Sarah live?" -> "sarah"
 */
function extractQuerySubject(query: string): string | null {
  // Common patterns for extracting the subject
  const patterns = [
    /where\s+(?:does|did|is|was)\s+(\w+)/i,
    /what\s+(?:is|was|does|did)\s+(\w+)(?:'s)?/i,
    /who\s+(?:is|was)\s+(\w+)/i,
    /when\s+(?:did|does|is|was|will)\s+(\w+)/i,
    /how\s+(?:is|are|does|did)\s+(\w+)/i,
    /(\w+)(?:'s)?\s+(?:job|work|home|house|apartment)/i,
  ];

  for (const pattern of patterns) {
    const match = query.match(pattern);
    if (match && match[1]) {
      const subject = match[1].toLowerCase();
      // Filter out common non-subject words
      if (!['the', 'a', 'an', 'this', 'that', 'my', 'your', 'their', 'our'].includes(subject)) {
        return subject;
      }
    }
  }
  return null;
}

/**
 * Extract key terms from query for exact matching
 * Identifies numbers, proper nouns, and specific terms that should have exact matches
 */
function extractKeyTerms(query: string): { numbers: string[]; properNouns: string[]; keywords: string[] } {
  const numbers: string[] = [];
  const properNouns: string[] = [];
  const keywords: string[] = [];

  // Extract numbers (including currency, percentages)
  const numberMatches = query.match(/\$?[\d,]+(?:\.\d+)?%?|\d+(?:st|nd|rd|th)?/gi);
  if (numberMatches) {
    numbers.push(...numberMatches.map(n => n.toLowerCase()));
  }

  // Extract words - check for proper nouns (capitalized words not at sentence start)
  const words = query.split(/\s+/);
  words.forEach((word, index) => {
    // Clean word
    const cleanWord = word.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    if (cleanWord.length < 2) return;

    // Check if capitalized (proper noun candidate)
    if (index > 0 && /^[A-Z]/.test(word) && word.length > 2) {
      properNouns.push(cleanWord);
    }

    // Domain-specific keywords that should be exact matched
    const importantKeywords = [
      'budget', 'revenue', 'salary', 'target', 'goal', 'deadline',
      'price', 'cost', 'amount', 'total', 'quarterly', 'annual',
      'q1', 'q2', 'q3', 'q4', 'million', 'billion', 'thousand',
      'ssn', 'password', 'secret', 'api', 'key', 'token',
      'address', 'phone', 'email', 'birthday', 'anniversary',
    ];

    if (importantKeywords.includes(cleanWord)) {
      keywords.push(cleanWord);
    }
  });

  return { numbers, properNouns, keywords };
}

/**
 * Intent-based reranking with query understanding
 * Analyzes query intent and boosts/penalizes results accordingly
 */
function intentBasedRerank(query: string, results: MemoryResult[]): MemoryResult[] {
  const queryLower = query.toLowerCase();
  const subject = extractQuerySubject(query);
  const keyTerms = extractKeyTerms(query);

  // Find matching intent pattern
  let matchedIntent: typeof QUERY_INTENT_PATTERNS[0] | null = null;
  for (const intentPattern of QUERY_INTENT_PATTERNS) {
    if (intentPattern.pattern.test(query)) {
      matchedIntent = intentPattern;
      break;
    }
  }

  // Extract significant query words (excluding stop words)
  const stopWords = new Set(['what', 'where', 'when', 'who', 'how', 'why', 'which', 'is', 'are', 'was', 'were', 'does', 'did', 'do', 'the', 'a', 'an', 'in', 'on', 'at', 'to', 'for', 'of', 'and', 'or', 'but', 'with', 'by', 'from', 'as', 'about', 'that', 'this', 'it', 'its', 'be', 'been', 'being', 'have', 'has', 'had', 'having', 'can', 'could', 'will', 'would', 'should', 'may', 'might', 'must', 'shall']);
  const queryWords = queryLower.split(/\s+/).filter(w => w.length > 2 && !stopWords.has(w));

  const scored = results.map(result => {
    const content = result.memory.toLowerCase();
    let boost = 0;
    let penalty = 0;

    // 0. EXACT KEY TERM MATCHING - Highest priority for specific numbers/terms
    // If query contains "$5M budget" and result contains "$5M" or "5 million", massive boost
    let exactMatchBoost = 0;

    // Check for number matches (critical for financial data)
    for (const num of keyTerms.numbers) {
      const cleanNum = num.replace(/[$,%]/g, '');
      // Check for exact number or word form
      if (content.includes(num) || content.includes(cleanNum)) {
        exactMatchBoost += 0.25;
      }
      // Check for word forms (5M -> 5 million, $5,000 -> 5000)
      const numValue = parseFloat(cleanNum.replace(/,/g, ''));
      if (!isNaN(numValue)) {
        // Million/billion detection
        if (content.includes(`${numValue} million`) || content.includes(`${numValue}m`)) {
          exactMatchBoost += 0.20;
        }
        if (content.includes(`${numValue} billion`) || content.includes(`${numValue}b`)) {
          exactMatchBoost += 0.20;
        }
      }
    }

    // Check for proper noun matches
    for (const noun of keyTerms.properNouns) {
      if (content.includes(noun)) {
        exactMatchBoost += 0.15;
      }
    }

    // Check for important keyword matches
    for (const keyword of keyTerms.keywords) {
      if (content.includes(keyword)) {
        exactMatchBoost += 0.15;
      }
    }

    boost += Math.min(0.50, exactMatchBoost); // Cap exact match boost at 50%

    // 1. Subject matching - strong boost if the query subject appears in the result
    if (subject && content.includes(subject)) {
      boost += 0.15;
    } else if (subject && !content.includes(subject)) {
      // Penalty if the subject doesn't match at all
      penalty += 0.10;
    }

    // 2. Intent-based scoring
    if (matchedIntent) {
      // Check positive indicators
      let positiveMatches = 0;
      for (const indicator of matchedIntent.positiveIndicators) {
        if (content.includes(indicator.toLowerCase())) {
          positiveMatches++;
        }
      }
      // Boost based on number of positive indicators matched
      if (positiveMatches > 0) {
        boost += Math.min(matchedIntent.weight, positiveMatches * (matchedIntent.weight / 3));
      }

      // Check negative indicators (e.g., "parents live" when asking where someone lives)
      for (const indicator of matchedIntent.negativeIndicators) {
        if (content.includes(indicator.toLowerCase())) {
          penalty += matchedIntent.weight * 0.6;  // Significant penalty for negative indicators
        }
      }
    }

    // 3. Keyword overlap scoring - more sophisticated than simple presence
    let keywordScore = 0;
    let exactPhraseBoost = 0;

    for (const word of queryWords) {
      if (content.includes(word)) {
        keywordScore += 0.03;  // Base boost per keyword

        // Extra boost for exact phrase matches (consecutive words)
        const wordIndex = content.indexOf(word);
        if (wordIndex > 0) {
          // Check if previous/next query words are adjacent in content
          const queryWordIdx = queryWords.indexOf(word);
          if (queryWordIdx > 0) {
            const prevWord = queryWords[queryWordIdx - 1];
            const contextBefore = content.substring(Math.max(0, wordIndex - 30), wordIndex);
            if (contextBefore.includes(prevWord)) {
              exactPhraseBoost += 0.05;
            }
          }
        }
      }
    }

    boost += Math.min(0.20, keywordScore);  // Cap keyword boost
    boost += Math.min(0.15, exactPhraseBoost);  // Cap phrase boost

    // 4. Specificity scoring - prefer more specific, detailed memories
    // Longer memories with relevant content are often more informative
    const wordCount = result.memory.split(/\s+/).length;
    if (wordCount >= 10 && wordCount <= 50) {
      boost += 0.02;  // Small boost for reasonably detailed memories
    }

    // Calculate final score
    const adjustedSimilarity = Math.max(0, Math.min(1.0, result.similarity + boost - penalty));

    return {
      ...result,
      similarity: adjustedSimilarity
    };
  });

  scored.sort((a, b) => b.similarity - a.similarity);
  return scored;
}

/**
 * Simple keyword-based reranking fallback
 */
function keywordRerank(query: string, results: MemoryResult[]): MemoryResult[] {
  // Use intent-based reranking as the new default
  return intentBasedRerank(query, results);
}

// ============================================================================
// ADVANCED FILTERING (Supermemory-compatible)
// ============================================================================

/**
 * Check if an object is a filter condition (has 'key' field)
 */
function isFilterCondition(obj: any): obj is FilterCondition {
  return obj && typeof obj === 'object' && 'key' in obj && 'value' in obj;
}

/**
 * Check if an object is a compound filter (has AND or OR)
 */
function isCompoundFilter(obj: any): obj is SearchFilter {
  return obj && typeof obj === 'object' && ('AND' in obj || 'OR' in obj);
}

/**
 * Validate and sanitize a filter condition
 */
function validateFilterCondition(condition: FilterCondition): boolean {
  // Check key is allowed
  if (!condition.key || typeof condition.key !== 'string') {
    console.warn('Invalid filter key');
    return false;
  }

  // Allow any key for metadata filtering (don't restrict to whitelist)
  // But limit key length to prevent DoS
  if (condition.key.length > 100) {
    console.warn('Filter key too long');
    return false;
  }

  // Check filterType is valid if specified
  if (condition.filterType && !VALID_FILTER_TYPES.has(condition.filterType)) {
    console.warn(`Invalid filter type: ${condition.filterType}`);
    return false;
  }

  // Check numericOperator is valid if specified
  if (condition.numericOperator && !VALID_NUMERIC_OPERATORS.has(condition.numericOperator)) {
    console.warn(`Invalid numeric operator: ${condition.numericOperator}`);
    return false;
  }

  // Sanitize value - prevent injection
  if (typeof condition.value === 'string') {
    // Limit string length to prevent DoS
    if (condition.value.length > 1000) {
      console.warn('Filter value too long');
      return false;
    }
  }

  return true;
}

/**
 * Get nested field value from an object using dot notation
 * e.g., getFieldValue(obj, 'metadata.category') returns obj.metadata.category
 */
function getFieldValue(obj: any, key: string): any {
  // First check if it's a direct field on the result
  if (obj[key] !== undefined) {
    return obj[key];
  }

  // Then check metadata
  if (obj.metadata && obj.metadata[key] !== undefined) {
    return obj.metadata[key];
  }

  // Support dot notation for nested access
  if (key.includes('.')) {
    const parts = key.split('.');
    let current = obj;
    for (const part of parts) {
      if (current === null || current === undefined) return undefined;
      current = current[part];
    }
    return current;
  }

  return undefined;
}

/**
 * Evaluate a single filter condition against a result
 * Supports Supermemory filter types: string_equal, string_contains, numeric, array_contains
 */
function evaluateCondition(result: any, condition: FilterCondition): boolean {
  if (!validateFilterCondition(condition)) {
    return true; // Invalid conditions pass (fail-open for security)
  }

  // Get field value from result
  let fieldValue = getFieldValue(result, condition.key);
  let conditionValue: any = condition.value;

  // Handle undefined field values
  if (fieldValue === undefined || fieldValue === null) {
    // If negating, undefined/null should pass (field doesn't have the value)
    return condition.negate === true;
  }

  // Determine filter type (default to string_equal)
  const filterType = condition.filterType || 'string_equal';

  let matches = false;

  switch (filterType) {
    case 'string_equal': {
      // Handle case insensitivity
      if (condition.ignoreCase && typeof fieldValue === 'string' && typeof conditionValue === 'string') {
        matches = fieldValue.toLowerCase() === conditionValue.toLowerCase();
      } else {
        matches = fieldValue === conditionValue;
      }
      break;
    }

    case 'string_contains': {
      if (typeof fieldValue === 'string' && typeof conditionValue === 'string') {
        if (condition.ignoreCase) {
          matches = fieldValue.toLowerCase().includes(conditionValue.toLowerCase());
        } else {
          matches = fieldValue.includes(conditionValue);
        }
      }
      break;
    }

    case 'numeric': {
      // Convert values to numbers for comparison
      const numFieldValue = typeof fieldValue === 'number' ? fieldValue : parseFloat(String(fieldValue));
      const numConditionValue = typeof conditionValue === 'number' ? conditionValue : parseFloat(String(conditionValue));

      if (isNaN(numFieldValue) || isNaN(numConditionValue)) {
        matches = false;
        break;
      }

      const operator = condition.numericOperator || '=';

      switch (operator) {
        case '=':
          matches = numFieldValue === numConditionValue;
          break;
        case '!=':
          matches = numFieldValue !== numConditionValue;
          break;
        case '>':
          matches = numFieldValue > numConditionValue;
          break;
        case '>=':
          matches = numFieldValue >= numConditionValue;
          break;
        case '<':
          matches = numFieldValue < numConditionValue;
          break;
        case '<=':
          matches = numFieldValue <= numConditionValue;
          break;
        default:
          matches = numFieldValue === numConditionValue;
      }
      break;
    }

    case 'array_contains': {
      // Check if the field is an array and contains the value
      if (Array.isArray(fieldValue)) {
        if (condition.ignoreCase && typeof conditionValue === 'string') {
          const lowerValue = conditionValue.toLowerCase();
          matches = fieldValue.some(item =>
            typeof item === 'string' ? item.toLowerCase() === lowerValue : item === conditionValue
          );
        } else {
          matches = fieldValue.includes(conditionValue);
        }
      }
      break;
    }

    default:
      // Unknown filter type, pass through
      matches = true;
  }

  // Apply negation if specified
  // For numeric operators, negation flips the logic
  if (condition.negate) {
    matches = !matches;
  }

  return matches;
}

/**
 * Evaluate a filter (condition or compound) against a result
 */
function evaluateFilter(result: any, filter: FilterCondition | SearchFilter): boolean {
  if (isFilterCondition(filter)) {
    return evaluateCondition(result, filter);
  }

  if (isCompoundFilter(filter)) {
    return evaluateCompoundFilter(result, filter);
  }

  // Unknown filter type, pass through
  return true;
}

/**
 * Evaluate compound filter (AND/OR) with support for nesting
 */
function evaluateCompoundFilter(result: any, filter: SearchFilter): boolean {
  // AND conditions - all must match
  if (filter.AND && filter.AND.length > 0) {
    const andResult = filter.AND.every(subFilter => evaluateFilter(result, subFilter));
    if (!andResult) return false;
  }

  // OR conditions - at least one must match
  if (filter.OR && filter.OR.length > 0) {
    const orResult = filter.OR.some(subFilter => evaluateFilter(result, subFilter));
    if (!orResult) return false;
  }

  return true;
}

/**
 * Apply compound filters (AND/OR) to results - Supermemory compatible
 */
function applyFilters(results: MemoryResult[], filters: SearchFilter): MemoryResult[] {
  if (!filters) return results;

  return results.filter(result => evaluateCompoundFilter(result, filters));
}

/**
 * Convert legacy filters to new format
 */
function convertLegacyFilters(legacyFilters: any): SearchFilter | undefined {
  // Check if it's already in new format
  if (legacyFilters.AND || legacyFilters.OR) {
    return legacyFilters as SearchFilter;
  }

  // Convert legacy format { categories, dateFrom, dateTo, isCore }
  const conditions: FilterCondition[] = [];

  if (legacyFilters.categories && legacyFilters.categories.length > 0) {
    // Convert categories to OR filter
    const categoryConditions = legacyFilters.categories.map((cat: string) => ({
      key: 'category',
      value: cat,
      filterType: 'string_equal' as FilterType
    }));
    if (categoryConditions.length === 1) {
      conditions.push(categoryConditions[0]);
    } else {
      return { AND: conditions, OR: categoryConditions };
    }
  }

  if (legacyFilters.dateFrom) {
    conditions.push({
      key: 'createdAt',
      value: legacyFilters.dateFrom,
      filterType: 'numeric',
      numericOperator: '>='
    });
  }

  if (legacyFilters.dateTo) {
    conditions.push({
      key: 'createdAt',
      value: legacyFilters.dateTo,
      filterType: 'numeric',
      numericOperator: '<='
    });
  }

  if (legacyFilters.isCore !== undefined) {
    conditions.push({
      key: 'isCore',
      value: legacyFilters.isCore,
      filterType: 'string_equal'
    });
  }

  if (conditions.length === 0) {
    return undefined;
  }

  return { AND: conditions };
}

/**
 * Legacy recall function for backwards compatibility
 */
export async function recall(
  userId: string,
  query: string,
  limit: number = 10
): Promise<MemoryResult[]> {
  const response = await searchMemories(userId, query, { limit, searchMode: 'hybrid' });
  return response.results;
}

// ============================================================================
// EXPORTS
// ============================================================================

export const RecallService = {
  searchMemories,
  searchDocuments,
  recall,
  // Expose filter functions for external use
  validateFilterCondition,
  applyFilters,
  convertLegacyFilters,
  evaluateCondition,
  evaluateFilter,
};
