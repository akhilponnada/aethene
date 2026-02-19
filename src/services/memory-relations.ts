/**
 * Memory Relations Service - Aethene memory graph
 *
 * Implements intelligent memory connections:
 * - SUPERSEDES: New memory replaces outdated info (job changes, location changes)
 * - ENRICHES: New memory adds detail to existing memory
 * - INFERRED: System derives new insight from patterns
 */

import { ConvexHttpClient } from 'convex/browser';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { embedText, embedQuery } from '../vector/embeddings.js';
import { Id } from '../../convex/_generated/dataModel.js';

// Types - Support both Aethene and Supermemory naming conventions
export type LinkType = 'supersedes' | 'enriches' | 'inferred';
export type SupermemoryLinkType = 'UPDATES' | 'EXTENDS' | 'DERIVES';
export type MemoryKind = 'fact' | 'preference' | 'event';

// Map between Supermemory and Aethene link types
export const LINK_TYPE_MAP: Record<SupermemoryLinkType, LinkType> = {
  'UPDATES': 'supersedes',
  'EXTENDS': 'enriches',
  'DERIVES': 'inferred'
};

export const REVERSE_LINK_TYPE_MAP: Record<LinkType, SupermemoryLinkType> = {
  'supersedes': 'UPDATES',
  'enriches': 'EXTENDS',
  'inferred': 'DERIVES'
};

/**
 * Convert Supermemory link type to Aethene link type
 */
export function toAetheneLinkType(type: string): LinkType {
  if (type in LINK_TYPE_MAP) {
    return LINK_TYPE_MAP[type as SupermemoryLinkType];
  }
  return type as LinkType;
}

/**
 * Convert Aethene link type to Supermemory link type
 */
export function toSupermemoryLinkType(type: LinkType): SupermemoryLinkType {
  return REVERSE_LINK_TYPE_MAP[type];
}

export interface Memory {
  _id: Id<"memories">;
  user_id: string;
  content: string;
  is_core: boolean;
  is_latest: boolean;
  is_forgotten: boolean;
  memory_kind?: MemoryKind;
  expires_at?: number;
  embedding?: number[];
  created_at: number;
  updated_at: number;
}

export interface MemoryLink {
  from_memory: Id<"memories">;
  to_memory: Id<"memories">;
  link_type: LinkType;
  confidence: number;
}

export interface RelationshipAnalysis {
  links: MemoryLink[];
  memoryKind: MemoryKind;
  expiresAt?: number;
}

// Extended relationship info for API responses
export interface MemoryRelationship {
  id: string;
  memoryId: string;
  relatedMemoryId: string;
  relationType: SupermemoryLinkType;
  aetheneType: LinkType;
  confidence: number;
  direction: 'outgoing' | 'incoming';
  relatedContent?: string;
  createdAt: number;
}

export interface MemoryWithRelationships {
  id: string;
  content: string;
  isLatest: boolean;
  version: number;
  relationships: MemoryRelationship[];
  supersededBy?: string;
  extends?: string[];
  derivedFrom?: string[];
}

// Content length limits for security
const MAX_CONTENT_LENGTH = 10000;

// Convex client singleton
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

// Gemini client for relationship analysis
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

/**
 * Sanitize content before processing
 */
function sanitizeContent(content: string): string {
  if (!content) return '';
  // Truncate to max length
  let sanitized = content.substring(0, MAX_CONTENT_LENGTH);
  // Remove potential injection patterns
  sanitized = sanitized.replace(/```/g, '');
  return sanitized;
}

/**
 * Validate memory ID format
 */
function isValidId(id: any): boolean {
  if (!id) return false;
  // Convex IDs are strings that start with specific patterns
  return typeof id === 'string' && id.length > 0;
}

/**
 * Detect temporal content in memory
 * Returns expiry timestamp if content is time-sensitive
 */
export function detectTemporalContent(content: string): number | undefined {
  if (!content) return undefined;

  const lowerContent = content.toLowerCase();

  // Patterns indicating temporary information
  const temporalPatterns = [
    { pattern: /\b(today|tonight)\b/i, expiryDays: 1 },
    { pattern: /\b(tomorrow)\b/i, expiryDays: 2 },
    { pattern: /\b(this week)\b/i, expiryDays: 7 },
    { pattern: /\b(next week)\b/i, expiryDays: 14 },
    { pattern: /\b(this month)\b/i, expiryDays: 30 },
    { pattern: /\b(currently|right now|at the moment)\b/i, expiryDays: 30 },
    { pattern: /\b(visiting|staying at|temporary)\b/i, expiryDays: 14 },
    { pattern: /\b(planning to|going to|will be)\b/i, expiryDays: 30 },
    { pattern: /\b(meeting|appointment|event)\b.*\b(scheduled|planned)\b/i, expiryDays: 7 },
  ];

  for (const { pattern, expiryDays } of temporalPatterns) {
    if (pattern.test(lowerContent)) {
      return Date.now() + expiryDays * 24 * 60 * 60 * 1000;
    }
  }

  return undefined;
}

/**
 * Classify memory kind based on content
 */
export function classifyMemoryKind(content: string): MemoryKind {
  const lowerContent = content.toLowerCase();

  // Event patterns
  const eventPatterns = [
    /\b(went|visited|attended|met|saw|did|made|created|completed)\b/i,
    /\b(yesterday|last week|last month|on \w+day)\b/i,
    /\b(meeting|event|appointment|trip|visit)\b/i,
  ];

  for (const pattern of eventPatterns) {
    if (pattern.test(lowerContent)) {
      return 'event';
    }
  }

  // Preference patterns
  const preferencePatterns = [
    /\b(prefer|like|love|enjoy|favorite|favourite|hate|dislike)\b/i,
    /\b(wants?|wishes?|hopes?)\b/i,
    /\b(always|never|usually|often)\b/i,
  ];

  for (const pattern of preferencePatterns) {
    if (pattern.test(lowerContent)) {
      return 'preference';
    }
  }

  // Default to fact
  return 'fact';
}

/**
 * Analyze relationships between a new memory and existing memories using Gemini
 */
export async function analyzeRelationships(
  userId: string,
  newMemory: { content: string; id: Id<"memories"> },
  existingMemories: Memory[]
): Promise<RelationshipAnalysis> {
  // Sanitize inputs
  const sanitizedContent = sanitizeContent(newMemory.content);
  if (!isValidId(newMemory.id)) {
    throw new Error('Invalid memory ID');
  }

  // Default result
  const result: RelationshipAnalysis = {
    links: [],
    memoryKind: classifyMemoryKind(sanitizedContent),
    expiresAt: detectTemporalContent(sanitizedContent),
  };

  // Filter to relevant existing memories (non-forgotten, latest)
  const relevantMemories = existingMemories.filter(
    (m) => m.is_latest && !m.is_forgotten && m._id !== newMemory.id
  );

  if (relevantMemories.length === 0) {
    return result;
  }

  // Prepare context for Gemini
  const existingContext = relevantMemories
    .slice(0, 20) // Limit to most recent 20
    .map((m, i) => `[${i}] ${sanitizeContent(m.content)}`)
    .join('\n');

  const model = getGenAI().getGenerativeModel({ model: 'gemini-2.0-flash' });

  const prompt = `Analyze how a NEW memory relates to EXISTING memories.

RELATIONSHIP TYPES:
- supersedes: New memory replaces/updates outdated information (same topic, newer info)
- enriches: New memory adds detail to existing memory (elaborates, provides context)
- inferred: (Reserved for system use)

NEW MEMORY:
"${sanitizedContent}"

EXISTING MEMORIES:
${existingContext}

RULES:
1. Only identify CLEAR relationships (confidence > 0.6)
2. supersedes: Use when new memory contradicts or updates old info (job changes, location changes, status updates)
3. enriches: Use when new memory provides additional detail about same topic
4. A memory can have multiple relationships
5. Return empty array if no clear relationships exist

Respond with JSON ONLY:
{
  "relationships": [
    {"existing_index": 0, "type": "supersedes", "confidence": 0.9, "reason": "Updates job title"},
    {"existing_index": 3, "type": "enriches", "confidence": 0.8, "reason": "Adds detail about project"}
  ]
}`;

  try {
    const response = await model.generateContent(prompt);
    const text = response.response.text();

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return result;
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const relationships = parsed.relationships || [];

    for (const rel of relationships) {
      const existingIndex = Number(rel.existing_index);
      const confidence = Number(rel.confidence);
      const linkType = String(rel.type);

      // Validate
      if (
        existingIndex < 0 ||
        existingIndex >= relevantMemories.length ||
        confidence < 0.6 ||
        !['supersedes', 'enriches'].includes(linkType)
      ) {
        continue;
      }

      const targetMemory = relevantMemories[existingIndex];

      result.links.push({
        from_memory: newMemory.id,
        to_memory: targetMemory._id,
        link_type: linkType as LinkType,
        confidence,
      });
    }
  } catch (error) {
    console.error('Relationship analysis error:', error);
    // Return partial result on error
  }

  return result;
}

/**
 * Create a link between two memories in Convex
 */
export async function linkMemories(
  fromId: Id<"memories">,
  toId: Id<"memories">,
  linkType: LinkType,
  confidence: number
): Promise<string | null> {
  // Validate inputs
  if (!isValidId(fromId) || !isValidId(toId)) {
    throw new Error('Invalid memory IDs');
  }
  if (confidence < 0 || confidence > 1) {
    throw new Error('Confidence must be between 0 and 1');
  }

  const client = getConvex();

  try {
    const linkId = await client.mutation('memoryLinks:createLink' as any, {
      fromMemory: fromId,
      toMemory: toId,
      linkType,
      confidence,
    });

    return linkId;
  } catch (error) {
    console.error('Failed to create memory link:', error);
    return null;
  }
}

/**
 * Get all memories linked to a given memory
 */
export async function getLinkedMemories(
  memoryId: Id<"memories">
): Promise<{
  outgoing: any[];
  incoming: any[];
}> {
  if (!isValidId(memoryId)) {
    throw new Error('Invalid memory ID');
  }

  const client = getConvex();

  try {
    const [outgoing, incoming] = await Promise.all([
      client.query('memoryLinks:getLinksBySource' as any, { memoryId }),
      client.query('memoryLinks:getLinksByTarget' as any, { memoryId }),
    ]);

    return { outgoing, incoming };
  } catch (error) {
    console.error('Failed to get linked memories:', error);
    return { outgoing: [], incoming: [] };
  }
}

/**
 * Schedule memory for auto-forget (expiry)
 */
export async function scheduleExpiry(
  memoryId: Id<"memories">,
  expiresAt: number
): Promise<boolean> {
  if (!isValidId(memoryId)) {
    throw new Error('Invalid memory ID');
  }

  const client = getConvex();

  try {
    await client.mutation('memoryLinks:setMemoryExpiry' as any, {
      memoryId,
      expiresAt,
    });
    return true;
  } catch (error) {
    console.error('Failed to schedule memory expiry:', error);
    return false;
  }
}

/**
 * Update memory kind classification
 */
export async function updateMemoryKind(
  memoryId: Id<"memories">,
  kind: MemoryKind
): Promise<boolean> {
  if (!isValidId(memoryId)) {
    throw new Error('Invalid memory ID');
  }

  const client = getConvex();

  try {
    await client.mutation('memoryLinks:setMemoryKind' as any, {
      memoryId,
      kind,
    });
    return true;
  } catch (error) {
    console.error('Failed to update memory kind:', error);
    return false;
  }
}

/**
 * Main entry point: Process a new memory after it's created
 * Analyzes relationships, creates links, and sets metadata
 */
export async function processNewMemory(
  userId: string,
  memoryId: Id<"memories">,
  content: string
): Promise<{
  links: number;
  kind: MemoryKind;
  expiresAt?: number;
}> {
  // Validate inputs
  if (!userId || typeof userId !== 'string') {
    throw new Error('Invalid user ID');
  }
  if (!isValidId(memoryId)) {
    throw new Error('Invalid memory ID');
  }

  const sanitizedContent = sanitizeContent(content);
  if (!sanitizedContent) {
    return { links: 0, kind: 'fact' };
  }

  const client = getConvex();

  // Fetch existing memories for this user
  let existingMemories: Memory[] = [];
  try {
    existingMemories = await client.query('memories:list' as any, {
      userId,
      limit: 50,
      includeOldVersions: false,
    });
  } catch (error) {
    console.error('Failed to fetch existing memories:', error);
    // Continue with empty list
  }

  // Analyze relationships
  const analysis = await analyzeRelationships(
    userId,
    { content: sanitizedContent, id: memoryId },
    existingMemories
  );

  // Create links in database
  let linksCreated = 0;
  for (const link of analysis.links) {
    const created = await linkMemories(
      link.from_memory,
      link.to_memory,
      link.link_type,
      link.confidence
    );
    if (created) {
      linksCreated++;

      // If this memory supersedes another, mark the old one as not latest
      // BUT keep the content (for history/audit trail)
      if (link.link_type === 'supersedes') {
        try {
          await client.mutation('memories:update' as any, {
            id: link.to_memory,
            // DON'T clear content - keep it for history
            metadata: { superseded_by: memoryId, superseded_at: Date.now() },
          });
        } catch (e) {
          // Non-critical, continue
        }
      }
    }
  }

  // Update memory kind
  await updateMemoryKind(memoryId, analysis.memoryKind);

  // Schedule expiry if temporal
  if (analysis.expiresAt) {
    await scheduleExpiry(memoryId, analysis.expiresAt);
  }

  return {
    links: linksCreated,
    kind: analysis.memoryKind,
    expiresAt: analysis.expiresAt,
  };
}

/**
 * Process expired memories - mark them as forgotten
 */
export async function processExpiredMemories(userId: string): Promise<number> {
  if (!userId || typeof userId !== 'string') {
    throw new Error('Invalid user ID');
  }

  const client = getConvex();

  try {
    const expiredMemories = await client.query(
      'memoryLinks:getExpiredMemories' as any,
      { userId }
    );

    let forgotten = 0;
    for (const memory of expiredMemories) {
      await client.mutation('memoryLinks:setMemoryForgotten' as any, {
        memoryId: memory._id,
        forgotten: true,
      });
      forgotten++;
    }

    return forgotten;
  } catch (error) {
    console.error('Failed to process expired memories:', error);
    return 0;
  }
}

/**
 * Get memory graph for visualization
 */
export async function getMemoryGraph(userId: string): Promise<{
  nodes: Array<{ id: string; content: string; kind: string; isCore: boolean }>;
  edges: Array<{ from: string; to: string; type: string; confidence: number }>;
}> {
  if (!userId || typeof userId !== 'string') {
    throw new Error('Invalid user ID');
  }

  const client = getConvex();

  try {
    // Get all memories
    const memories = await client.query('memories:list' as any, {
      userId,
      limit: 100,
      includeOldVersions: false,
    });

    const nodes = memories.map((m: Memory) => ({
      id: m._id,
      content: m.content.substring(0, 100),
      kind: m.memory_kind || 'fact',
      isCore: m.is_core,
    }));

    // Get all links for these memories
    const edges: Array<{ from: string; to: string; type: string; confidence: number }> = [];
    const seenEdges = new Set<string>();

    for (const memory of memories) {
      const { outgoing } = await getLinkedMemories(memory._id);
      for (const link of outgoing) {
        const edgeKey = `${link.from_memory}-${link.to_memory}`;
        if (!seenEdges.has(edgeKey)) {
          edges.push({
            from: link.from_memory,
            to: link.to_memory,
            type: link.link_type,
            confidence: link.confidence,
          });
          seenEdges.add(edgeKey);
        }
      }
    }

    return { nodes, edges };
  } catch (error) {
    console.error('Failed to get memory graph:', error);
    return { nodes: [], edges: [] };
  }
}

/**
 * Get memory with all its relationships in Supermemory-compatible format
 */
export async function getMemoryWithRelationships(
  memoryId: Id<"memories">
): Promise<MemoryWithRelationships | null> {
  if (!isValidId(memoryId)) {
    throw new Error('Invalid memory ID');
  }

  const client = getConvex();

  try {
    // Get the memory
    const memory = await client.query('memories:get' as any, { id: memoryId });
    if (!memory) {
      return null;
    }

    // Get relationships
    const { outgoing, incoming } = await getLinkedMemories(memoryId);

    const relationships: MemoryRelationship[] = [];
    let supersededBy: string | undefined;
    const extends_: string[] = [];
    const derivedFrom: string[] = [];

    // Process outgoing relationships (this memory -> other)
    for (const link of outgoing) {
      const rel: MemoryRelationship = {
        id: link._id || `${link.from_memory}-${link.to_memory}`,
        memoryId: String(memoryId),
        relatedMemoryId: link.to_memory,
        relationType: toSupermemoryLinkType(link.link_type),
        aetheneType: link.link_type,
        confidence: link.confidence,
        direction: 'outgoing',
        relatedContent: link.target_content,
        createdAt: link.created_at || Date.now(),
      };
      relationships.push(rel);

      // Track specific relationship types
      if (link.link_type === 'enriches') {
        extends_.push(link.to_memory);
      } else if (link.link_type === 'inferred') {
        derivedFrom.push(link.to_memory);
      }
    }

    // Process incoming relationships (other -> this memory)
    for (const link of incoming) {
      const rel: MemoryRelationship = {
        id: link._id || `${link.from_memory}-${link.to_memory}`,
        memoryId: String(memoryId),
        relatedMemoryId: link.from_memory,
        relationType: toSupermemoryLinkType(link.link_type),
        aetheneType: link.link_type,
        confidence: link.confidence,
        direction: 'incoming',
        relatedContent: link.source_content,
        createdAt: link.created_at || Date.now(),
      };
      relationships.push(rel);

      // If this memory is superseded by another
      if (link.link_type === 'supersedes') {
        supersededBy = link.from_memory;
      }
    }

    return {
      id: String(memoryId),
      content: memory.content,
      isLatest: memory.is_latest,
      version: memory.version || 1,
      relationships,
      supersededBy,
      extends: extends_.length > 0 ? extends_ : undefined,
      derivedFrom: derivedFrom.length > 0 ? derivedFrom : undefined,
    };
  } catch (error) {
    console.error('Failed to get memory with relationships:', error);
    return null;
  }
}

/**
 * Get all relationships for a user (for graph visualization)
 */
export async function getAllRelationships(
  userId: string
): Promise<{
  relationships: MemoryRelationship[];
  byType: Record<SupermemoryLinkType, number>;
}> {
  if (!userId || typeof userId !== 'string') {
    throw new Error('Invalid user ID');
  }

  const client = getConvex();

  try {
    // Get all memories
    const memories = await client.query('memories:list' as any, {
      userId,
      limit: 100,
      includeOldVersions: false,
    });

    const relationships: MemoryRelationship[] = [];
    const byType: Record<SupermemoryLinkType, number> = {
      'UPDATES': 0,
      'EXTENDS': 0,
      'DERIVES': 0,
    };
    const seenLinks = new Set<string>();

    for (const memory of memories) {
      const { outgoing } = await getLinkedMemories(memory._id);

      for (const link of outgoing) {
        const linkKey = `${link.from_memory}-${link.to_memory}`;
        if (seenLinks.has(linkKey)) continue;
        seenLinks.add(linkKey);

        const supermemoryType = toSupermemoryLinkType(link.link_type);
        byType[supermemoryType]++;

        relationships.push({
          id: link._id || linkKey,
          memoryId: link.from_memory,
          relatedMemoryId: link.to_memory,
          relationType: supermemoryType,
          aetheneType: link.link_type,
          confidence: link.confidence,
          direction: 'outgoing',
          relatedContent: link.target_content,
          createdAt: link.created_at || Date.now(),
        });
      }
    }

    return { relationships, byType };
  } catch (error) {
    console.error('Failed to get all relationships:', error);
    return { relationships: [], byType: { 'UPDATES': 0, 'EXTENDS': 0, 'DERIVES': 0 } };
  }
}

/**
 * Detect derived/inferred relationships from patterns
 * This runs periodically to find patterns like:
 * - If A works at X and B works at X -> A and B are colleagues
 * - If user prefers X and Y, and X relates to Z -> user might like Z
 */
export async function inferRelationships(
  userId: string
): Promise<{
  inferred: number;
  patterns: string[];
}> {
  if (!userId || typeof userId !== 'string') {
    throw new Error('Invalid user ID');
  }

  const client = getConvex();
  let inferred = 0;
  const patterns: string[] = [];

  try {
    // Get all memories for this user
    const memories = await client.query('memories:list' as any, {
      userId,
      limit: 100,
      includeOldVersions: false,
    });

    if (memories.length < 2) {
      return { inferred: 0, patterns: [] };
    }

    // Use Gemini to find patterns
    const model = getGenAI().getGenerativeModel({ model: 'gemini-2.0-flash' });

    const memoryContext = memories
      .slice(0, 30)
      .map((m: Memory, i: number) => `[${i}] ${sanitizeContent(m.content)}`)
      .join('\n');

    const prompt = `Analyze these memories and identify INFERRED relationships - new facts that can be derived from combining existing memories.

MEMORIES:
${memoryContext}

RULES:
1. Only identify HIGH CONFIDENCE inferences (confidence > 0.7)
2. Look for patterns like:
   - If person A works at company X and person B works at company X -> they might be colleagues
   - If user likes X and Y, and they share properties -> user might like Z
   - If user visited place A and place B, and they're in same region -> user is familiar with region
3. The inference must be NOVEL (not already stated in memories)
4. Each inference should reference which memories it's derived from

Respond with JSON ONLY:
{
  "inferences": [
    {
      "content": "Sarah and John are likely colleagues",
      "derived_from": [0, 5],
      "confidence": 0.8,
      "pattern": "same_company"
    }
  ]
}`;

    const response = await model.generateContent(prompt);
    const text = response.response.text();

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { inferred: 0, patterns: [] };
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const inferences = parsed.inferences || [];

    for (const inference of inferences) {
      if (
        !inference.content ||
        !inference.derived_from ||
        inference.derived_from.length < 2 ||
        inference.confidence < 0.7
      ) {
        continue;
      }

      // Create the inferred memory
      const { embedText } = await import('../vector/embeddings.js');
      const embedding = await embedText(inference.content);

      const inferredMemoryId = await client.mutation('memories:create' as any, {
        userId,
        content: inference.content,
        isCore: false,
        metadata: {
          inferred: true,
          derived_from: inference.derived_from.map((i: number) => memories[i]?._id).filter(Boolean),
          pattern: inference.pattern,
          confidence: inference.confidence,
        },
        embedding,
      });

      if (inferredMemoryId) {
        // Create DERIVES links to source memories
        for (const sourceIndex of inference.derived_from) {
          const sourceMemory = memories[sourceIndex];
          if (sourceMemory) {
            await linkMemories(
              inferredMemoryId as Id<"memories">,
              sourceMemory._id,
              'inferred',
              inference.confidence
            );
          }
        }

        inferred++;
        patterns.push(inference.pattern);
      }
    }

    return { inferred, patterns };
  } catch (error) {
    console.error('Failed to infer relationships:', error);
    return { inferred: 0, patterns: [] };
  }
}

/**
 * Mark a memory as superseded by another (manual override)
 */
export async function markAsSuperseded(
  newMemoryId: Id<"memories">,
  oldMemoryId: Id<"memories">,
  confidence: number = 1.0
): Promise<boolean> {
  if (!isValidId(newMemoryId) || !isValidId(oldMemoryId)) {
    throw new Error('Invalid memory IDs');
  }

  const client = getConvex();

  try {
    // Create supersedes link
    await linkMemories(newMemoryId, oldMemoryId, 'supersedes', confidence);

    // Mark old memory as not latest
    await client.mutation('memories:update' as any, {
      id: oldMemoryId,
      is_latest: false,
      metadata: { superseded_by: newMemoryId, superseded_at: Date.now() },
    });

    return true;
  } catch (error) {
    console.error('Failed to mark as superseded:', error);
    return false;
  }
}

/**
 * Find memories that might contradict each other (potential UPDATES candidates)
 */
export async function findContradictions(
  userId: string
): Promise<Array<{
  memory1: { id: string; content: string };
  memory2: { id: string; content: string };
  confidence: number;
  reason: string;
}>> {
  if (!userId || typeof userId !== 'string') {
    throw new Error('Invalid user ID');
  }

  const client = getConvex();

  try {
    const memories = await client.query('memories:list' as any, {
      userId,
      limit: 50,
      includeOldVersions: false,
    });

    if (memories.length < 2) {
      return [];
    }

    const model = getGenAI().getGenerativeModel({ model: 'gemini-2.0-flash' });

    const memoryContext = memories
      .slice(0, 30)
      .map((m: Memory, i: number) => `[${i}] ${sanitizeContent(m.content)}`)
      .join('\n');

    const prompt = `Analyze these memories and identify CONTRADICTIONS - pairs of memories that contain conflicting information.

MEMORIES:
${memoryContext}

RULES:
1. Look for factual contradictions (e.g., different job titles, different ages, conflicting preferences)
2. The newer memory typically supersedes the older one
3. Only identify CLEAR contradictions (confidence > 0.7)

Respond with JSON ONLY:
{
  "contradictions": [
    {
      "memory1_index": 0,
      "memory2_index": 5,
      "confidence": 0.9,
      "reason": "Memory 0 says works at Google, Memory 5 says works at Microsoft"
    }
  ]
}`;

    const response = await model.generateContent(prompt);
    const text = response.response.text();

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return [];
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const contradictions = parsed.contradictions || [];

    return contradictions
      .filter((c: any) => c.confidence >= 0.7)
      .map((c: any) => ({
        memory1: {
          id: memories[c.memory1_index]?._id || '',
          content: memories[c.memory1_index]?.content || '',
        },
        memory2: {
          id: memories[c.memory2_index]?._id || '',
          content: memories[c.memory2_index]?.content || '',
        },
        confidence: c.confidence,
        reason: c.reason,
      }))
      .filter((c: any) => c.memory1.id && c.memory2.id);
  } catch (error) {
    console.error('Failed to find contradictions:', error);
    return [];
  }
}

// Export service object
export const MemoryRelationsService = {
  analyzeRelationships,
  linkMemories,
  getLinkedMemories,
  processNewMemory,
  scheduleExpiry,
  updateMemoryKind,
  detectTemporalContent,
  classifyMemoryKind,
  processExpiredMemories,
  getMemoryGraph,
  // New Supermemory-compatible functions
  getMemoryWithRelationships,
  getAllRelationships,
  inferRelationships,
  markAsSuperseded,
  findContradictions,
  // Link type conversion utilities
  toAetheneLinkType,
  toSupermemoryLinkType,
  LINK_TYPE_MAP,
  REVERSE_LINK_TYPE_MAP,
};
