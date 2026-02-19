/**
 * Context Builder Service - Supermemory-compatible profile API
 *
 * Returns user profile exactly like Supermemory:
 * {
 *   "profile": {
 *     "static": ["Sarah Johnson is 28 years old", ...],
 *     "dynamic": ["User prefers dark mode", ...]
 *   },
 *   "searchResults": { ... }  // Optional, when query provided
 * }
 */

import { ConvexHttpClient } from 'convex/browser';
import { embedText } from '../vector/embeddings.js';

// Supermemory-compatible profile response
export interface ProfileResponse {
  profile: {
    static: string[];   // Named entity facts (permanent)
    dynamic: string[];  // "User" prefixed facts (preferences, context)
  };
  searchResults?: {
    results: MemorySearchResult[];
    total: number;
    timing: number;
  };
}

export interface MemorySearchResult {
  id: string;
  memory: string;
  rootMemoryId: string;
  metadata: any;
  updatedAt: string;
  version: number;
  similarity: number;
  documents?: Array<{
    id: string;
    createdAt: string;
    updatedAt: string;
    title: string;
    type: string;
    metadata: any;
  }>;
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
 * Get user profile - Supermemory-compatible
 *
 * Static = is_core=true memories (named entity facts like "Sarah Johnson is...")
 * Dynamic = is_core=false memories ("User prefers...", "User's manager is...")
 */
export async function getProfile(
  userId: string,
  options: {
    q?: string;           // Optional search query
    threshold?: number;   // Minimum similarity score
    includeRecent?: boolean;
    containerTag?: string; // Filter by container tag
  } = {}
): Promise<ProfileResponse> {
  const { q: query, threshold = 0.5, includeRecent = true, containerTag } = options;
  const startTime = Date.now();
  const client = getConvex();

  // Fetch static and dynamic memories in parallel
  const [staticMemories, dynamicMemories] = await Promise.all([
    fetchStaticMemories(client, userId),
    fetchDynamicMemories(client, userId, includeRecent)
  ]);

  // Filter by containerTag if provided
  const filterByContainer = (memories: MemoryRecord[]) => {
    if (!containerTag) return memories;
    return memories.filter(m => {
      const tags = (m as any).container_tags || [];
      return tags.includes(containerTag);
    });
  };

  const filteredStatic = filterByContainer(staticMemories);
  const filteredDynamic = filterByContainer(dynamicMemories);

  // Filter out empty content and normalize
  const response: ProfileResponse = {
    profile: {
      static: filteredStatic
        .map(m => m.content)
        .filter(c => c && c.trim().length > 0),
      dynamic: filteredDynamic
        .map(m => m.content)
        .filter(c => c && c.trim().length > 0)
    }
  };

  // If query provided, add search results
  if (query && query.trim().length > 0) {
    const searchResults = await searchMemories(client, userId, query, threshold);
    response.searchResults = {
      results: searchResults,
      total: searchResults.length,
      timing: Date.now() - startTime
    };
  }

  return response;
}

interface MemoryRecord {
  _id: string;
  content: string;
  is_core: boolean;
  is_latest: boolean;
  is_forgotten: boolean;
  version: number;
  source_document?: string;
  metadata?: any;
  container_tags?: string[];
  created_at: number;
  updated_at: number;
  embedding?: number[];
}

/**
 * Fetch static memories (is_core=true) - permanent facts with names
 * Example: "Sarah Johnson is 28 years old"
 */
async function fetchStaticMemories(
  client: ConvexHttpClient,
  userId: string
): Promise<MemoryRecord[]> {
  try {
    const results = await client.query('memories:getByUser' as any, {
      userId,
      isCore: true,
      limit: 50
    });
    return results || [];
  } catch (error: any) {
    console.warn('Failed to fetch static memories:', error.message);
    return [];
  }
}

/**
 * Fetch dynamic memories (is_core=false) - "User" prefixed facts
 * Example: "User prefers dark mode"
 */
async function fetchDynamicMemories(
  client: ConvexHttpClient,
  userId: string,
  includeRecent: boolean
): Promise<MemoryRecord[]> {
  try {
    const results = await client.query('memories:getByUser' as any, {
      userId,
      isCore: false,
      limit: includeRecent ? 50 : 20
    });
    return results || [];
  } catch (error: any) {
    console.warn('Failed to fetch dynamic memories:', error.message);
    return [];
  }
}

/**
 * Search memories by vector similarity
 */
async function searchMemories(
  client: ConvexHttpClient,
  userId: string,
  query: string,
  threshold: number
): Promise<MemorySearchResult[]> {
  try {
    // Generate query embedding
    const embedding = await embedText(query);

    // Vector search memories
    const results = await client.query('vectorSearch:searchMemories' as any, {
      user_id: userId,
      embedding,
      limit: 20
    });

    if (!results) return [];

    // Format results like Supermemory
    return results
      .filter((r: any) => r._score >= threshold)
      .map((r: any) => ({
        id: r._id,
        memory: r.content,
        rootMemoryId: r._id,  // Root memory tracking
        metadata: r.metadata || null,
        updatedAt: new Date(r.updated_at || r.created_at).toISOString(),
        version: r.version || 1,
        similarity: r._score,
        documents: r.source_document ? [{
          id: r.source_document,
          createdAt: new Date(r.created_at).toISOString(),
          updatedAt: new Date(r.updated_at || r.created_at).toISOString(),
          title: '',
          type: 'text',
          metadata: {}
        }] : undefined
      }));
  } catch (error: any) {
    console.warn('Memory search failed:', error.message);
    return [];
  }
}

/**
 * Get context formatted for LLM system prompt
 */
export function formatContextForPrompt(profile: ProfileResponse): string {
  const sections: string[] = [];

  if (profile.profile.static.length > 0) {
    sections.push('## About the User\n' + profile.profile.static.map(s => `- ${s}`).join('\n'));
  }

  if (profile.profile.dynamic.length > 0) {
    sections.push('## User Preferences & Context\n' + profile.profile.dynamic.map(d => `- ${d}`).join('\n'));
  }

  if (sections.length === 0) {
    return '';
  }

  return sections.join('\n\n');
}

/**
 * Legacy alias for backwards compatibility
 */
export async function getContext(
  userId: string,
  query?: string
): Promise<{ core: string[]; recent: string[] }> {
  const profile = await getProfile(userId, { q: query });
  return {
    core: profile.profile.static,
    recent: profile.profile.dynamic
  };
}

export const ContextBuilder = {
  getProfile,
  getContext,
  formatContextForPrompt
};
