/**
 * Graph Builder Service
 *
 * Automatically builds semantic understanding graphs from memories.
 * Similar to Supermemory's graph memory feature.
 *
 * Flow:
 * 1. Extract entities from memory content using LLM
 * 2. Find or create entity nodes
 * 3. Extract relationships between entities
 * 4. Link entities together
 * 5. Link memory to entities
 */

import { GoogleGenerativeAI } from '@google/generative-ai';

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

// =============================================================================
// TYPES
// =============================================================================

interface ExtractedEntity {
  name: string;
  type: 'person' | 'organization' | 'location' | 'date' | 'concept' | 'other';
  role: 'subject' | 'object' | 'mentioned';
}

interface ExtractedRelationship {
  from: string;  // Entity name
  to: string;    // Entity name
  relationship: string;
  confidence: number;
}

interface GraphExtractionResult {
  entities: ExtractedEntity[];
  relationships: ExtractedRelationship[];
}

// =============================================================================
// ENTITY & RELATIONSHIP EXTRACTION
// =============================================================================

const GRAPH_EXTRACTION_PROMPT = `You are an entity and relationship extractor. Analyze the given text and extract:

1. ENTITIES: Named things (people, organizations, locations, dates, concepts)
2. RELATIONSHIPS: How entities relate to each other

For each entity, determine:
- name: The entity name (e.g., "John Smith", "Google", "San Francisco")
- type: person, organization, location, date, concept, or other
- role: subject (main actor), object (acted upon), or mentioned (referenced)

For each relationship, determine:
- from: Source entity name
- to: Target entity name
- relationship: One of: works_at, lives_in, married_to, friend_of, owns, located_in, part_of, manages, founded, created, related_to
- confidence: 0.0-1.0 how confident you are

Respond ONLY with valid JSON in this format:
{
  "entities": [
    {"name": "John Smith", "type": "person", "role": "subject"},
    {"name": "Google", "type": "organization", "role": "object"}
  ],
  "relationships": [
    {"from": "John Smith", "to": "Google", "relationship": "works_at", "confidence": 0.95}
  ]
}

If no entities or relationships found, return empty arrays.
Do NOT include any explanation, just the JSON.`;

/**
 * Extract entities and relationships from a memory using LLM
 */
export async function extractGraphFromMemory(content: string): Promise<GraphExtractionResult> {
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

    const result = await model.generateContent([
      { text: GRAPH_EXTRACTION_PROMPT },
      { text: `Text to analyze:\n${content}` },
    ]);

    const response = result.response.text().trim();

    // Extract JSON from response
    let jsonStr = response;
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      jsonStr = jsonMatch[0];
    }

    const parsed = JSON.parse(jsonStr);

    return {
      entities: (parsed.entities || []).map((e: any) => ({
        name: e.name,
        type: e.type || 'other',
        role: e.role || 'mentioned',
      })),
      relationships: (parsed.relationships || []).map((r: any) => ({
        from: r.from,
        to: r.to,
        relationship: r.relationship || 'related_to',
        confidence: r.confidence || 0.5,
      })),
    };
  } catch (error) {
    console.warn('[GraphBuilder] Failed to extract graph:', error);
    return { entities: [], relationships: [] };
  }
}

/**
 * Simple entity extraction without LLM (fallback/fast mode)
 * Uses regex patterns to find names, organizations, locations
 */
export function extractEntitiesSimple(content: string): ExtractedEntity[] {
  const entities: ExtractedEntity[] = [];
  const seen = new Set<string>();

  // Match capitalized names (likely people or orgs)
  const namePattern = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/g;
  let match;
  while ((match = namePattern.exec(content)) !== null) {
    const name = match[1];
    if (!seen.has(name.toLowerCase())) {
      seen.add(name.toLowerCase());
      // Determine type based on context
      const lowerContent = content.toLowerCase();
      const lowerName = name.toLowerCase();
      let type: 'person' | 'organization' | 'location' | 'other' = 'person';

      // Organization indicators
      if (/(?:inc|corp|llc|ltd|company|organization|institute|university)\b/i.test(content) ||
          lowerContent.includes(`at ${lowerName}`) ||
          lowerContent.includes(`for ${lowerName}`)) {
        type = 'organization';
      }
      // Location indicators
      else if (/(?:in|from|to|at)\s+(?:the\s+)?/i.test(content.substring(0, match.index + 10)) ||
               /(?:city|state|country|town|village)\b/i.test(content)) {
        type = 'location';
      }

      entities.push({ name, type, role: 'mentioned' });
    }
  }

  return entities;
}

// =============================================================================
// GRAPH BUILDING
// =============================================================================

interface BuildGraphOptions {
  userId: string;
  memoryId: string;
  memoryContent: string;
  containerTags?: string[];
  useLLM?: boolean;  // Default true
}

/**
 * Build the entity graph for a memory
 * This is the main entry point called after memory extraction
 */
export async function buildGraphForMemory(options: BuildGraphOptions): Promise<{
  entities: number;
  relationships: number;
}> {
  const { userId, memoryId, memoryContent, containerTags, useLLM = true } = options;

  try {
    // Step 1: Extract entities and relationships
    let extraction: GraphExtractionResult;
    if (useLLM) {
      extraction = await extractGraphFromMemory(memoryContent);
    } else {
      extraction = {
        entities: extractEntitiesSimple(memoryContent),
        relationships: [],
      };
    }

    if (extraction.entities.length === 0) {
      return { entities: 0, relationships: 0 };
    }

    // Step 2: Import Convex client
    const { getConvexClient } = await import('../database/convex.js');
    const convex = getConvexClient();

    // Step 3: Find or create entities
    const entityMap = new Map<string, string>(); // name -> entity ID

    const entityResults = await convex.mutation('entities:findOrCreateBatch' as any, {
      userId,
      entities: extraction.entities.map(e => ({
        name: e.name,
        entityType: e.type,
      })),
      containerTags,
    });

    for (const result of entityResults as any[]) {
      entityMap.set(result.name.toLowerCase(), result.id);
    }

    // Step 4: Link memory to entities
    const memoryEntityLinks = extraction.entities.map(e => ({
      entityId: entityMap.get(e.name.toLowerCase()),
      role: e.role,
    })).filter(l => l.entityId);

    if (memoryEntityLinks.length > 0) {
      await convex.mutation('entities:linkMemoryToEntitiesBatch' as any, {
        memoryId,
        entities: memoryEntityLinks,
      });
    }

    // Step 5: Create entity relationships
    let relationshipsCreated = 0;
    for (const rel of extraction.relationships) {
      const fromId = entityMap.get(rel.from.toLowerCase());
      const toId = entityMap.get(rel.to.toLowerCase());

      if (fromId && toId) {
        await convex.mutation('entities:createLink' as any, {
          userId,
          fromEntity: fromId,
          toEntity: toId,
          relationship: rel.relationship,
          confidence: rel.confidence,
          sourceMemory: memoryId,
        });
        relationshipsCreated++;
      }
    }

    console.log(`[GraphBuilder] Built graph: ${extraction.entities.length} entities, ${relationshipsCreated} relationships`);

    return {
      entities: extraction.entities.length,
      relationships: relationshipsCreated,
    };
  } catch (error) {
    console.warn('[GraphBuilder] Failed to build graph:', error);
    return { entities: 0, relationships: 0 };
  }
}

/**
 * Build graph for multiple memories (batch processing)
 */
export async function buildGraphForMemories(
  memories: Array<{ id: string; content: string }>,
  userId: string,
  containerTags?: string[]
): Promise<{ totalEntities: number; totalRelationships: number }> {
  let totalEntities = 0;
  let totalRelationships = 0;

  for (const memory of memories) {
    const result = await buildGraphForMemory({
      userId,
      memoryId: memory.id,
      memoryContent: memory.content,
      containerTags,
      useLLM: true,
    });
    totalEntities += result.entities;
    totalRelationships += result.relationships;
  }

  return { totalEntities, totalRelationships };
}

// Export for use
export const GraphBuilder = {
  extractGraphFromMemory,
  extractEntitiesSimple,
  buildGraphForMemory,
  buildGraphForMemories,
};
