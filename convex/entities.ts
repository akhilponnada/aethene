import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

/**
 * Entity Graph - Aethene semantic understanding graph
 *
 * Entities are extracted from memories and linked together to form
 * a knowledge graph similar to Supermemory's semantic graphs.
 *
 * Entity types:
 * - person: People mentioned (John, Sarah, Dr. Smith)
 * - organization: Companies, institutions (Google, MIT)
 * - location: Places (San Francisco, Japan)
 * - date: Dates and times
 * - concept: Abstract concepts
 * - other: Everything else
 *
 * Relationship types:
 * - works_at: Person -> Organization
 * - lives_in: Person -> Location
 * - married_to: Person -> Person
 * - friend_of: Person -> Person
 * - owns: Person -> Entity
 * - located_in: Location -> Location
 * - part_of: Entity -> Entity
 * - related_to: Generic relationship
 */

// =============================================================================
// ENTITY CRUD
// =============================================================================

// Find or create an entity
export const findOrCreate = mutation({
  args: {
    userId: v.string(),
    name: v.string(),
    entityType: v.string(),
    containerTags: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const normalizedName = args.name.toLowerCase().trim();

    // Check if entity already exists
    const existing = await ctx.db
      .query("entities")
      .withIndex("by_user_name", (q) =>
        q.eq("user_id", args.userId).eq("normalized_name", normalizedName)
      )
      .first();

    if (existing) {
      // Update mention count
      await ctx.db.patch(existing._id, {
        mention_count: (existing.mention_count || 0) + 1,
        updated_at: Date.now(),
      });
      return existing._id;
    }

    // Create new entity
    const id = await ctx.db.insert("entities", {
      user_id: args.userId,
      name: args.name,
      normalized_name: normalizedName,
      entity_type: args.entityType,
      mention_count: 1,
      container_tags: args.containerTags,
      created_at: Date.now(),
      updated_at: Date.now(),
    });

    return id;
  },
});

// Batch find or create entities
export const findOrCreateBatch = mutation({
  args: {
    userId: v.string(),
    entities: v.array(
      v.object({
        name: v.string(),
        entityType: v.string(),
      })
    ),
    containerTags: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const results: Array<{ name: string; id: string; isNew: boolean }> = [];

    for (const entity of args.entities) {
      const normalizedName = entity.name.toLowerCase().trim();

      // Check if entity already exists
      const existing = await ctx.db
        .query("entities")
        .withIndex("by_user_name", (q) =>
          q.eq("user_id", args.userId).eq("normalized_name", normalizedName)
        )
        .first();

      if (existing) {
        // Update mention count
        await ctx.db.patch(existing._id, {
          mention_count: (existing.mention_count || 0) + 1,
          updated_at: Date.now(),
        });
        results.push({ name: entity.name, id: existing._id, isNew: false });
      } else {
        // Create new entity
        const id = await ctx.db.insert("entities", {
          user_id: args.userId,
          name: entity.name,
          normalized_name: normalizedName,
          entity_type: entity.entityType,
          mention_count: 1,
          container_tags: args.containerTags,
          created_at: Date.now(),
          updated_at: Date.now(),
        });
        results.push({ name: entity.name, id, isNew: true });
      }
    }

    return results;
  },
});

// Get entity by ID
export const getById = query({
  args: {
    id: v.id("entities"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

// Get all entities for a user
export const getByUser = query({
  args: {
    userId: v.string(),
    entityType: v.optional(v.string()),
    limit: v.optional(v.float64()),
  },
  handler: async (ctx, args) => {
    let query = ctx.db
      .query("entities")
      .withIndex("by_user", (q) => q.eq("user_id", args.userId));

    let entities = await query.collect();

    // Filter by type if specified
    if (args.entityType) {
      entities = entities.filter((e) => e.entity_type === args.entityType);
    }

    // Sort by mention count (most mentioned first)
    entities.sort((a, b) => (b.mention_count || 0) - (a.mention_count || 0));

    // Apply limit
    if (args.limit) {
      entities = entities.slice(0, args.limit);
    }

    return entities;
  },
});

// Search entities by name
export const searchByName = query({
  args: {
    userId: v.string(),
    query: v.string(),
    limit: v.optional(v.float64()),
  },
  handler: async (ctx, args) => {
    const normalizedQuery = args.query.toLowerCase().trim();

    const entities = await ctx.db
      .query("entities")
      .withIndex("by_user", (q) => q.eq("user_id", args.userId))
      .collect();

    // Filter by name match
    const matches = entities.filter((e) =>
      e.normalized_name.includes(normalizedQuery)
    );

    // Sort by relevance (exact match first, then mention count)
    matches.sort((a, b) => {
      const aExact = a.normalized_name === normalizedQuery ? 1 : 0;
      const bExact = b.normalized_name === normalizedQuery ? 1 : 0;
      if (aExact !== bExact) return bExact - aExact;
      return (b.mention_count || 0) - (a.mention_count || 0);
    });

    return matches.slice(0, args.limit || 20);
  },
});

// =============================================================================
// ENTITY LINKS (Relationships)
// =============================================================================

// Create a relationship between two entities
export const createLink = mutation({
  args: {
    userId: v.string(),
    fromEntity: v.id("entities"),
    toEntity: v.id("entities"),
    relationship: v.string(),
    confidence: v.float64(),
    sourceMemory: v.optional(v.id("memories")),
  },
  handler: async (ctx, args) => {
    // Check if link already exists
    const existing = await ctx.db
      .query("entity_links")
      .withIndex("by_from", (q) => q.eq("from_entity", args.fromEntity))
      .filter((q) =>
        q.and(
          q.eq(q.field("to_entity"), args.toEntity),
          q.eq(q.field("relationship"), args.relationship)
        )
      )
      .first();

    if (existing) {
      // Update confidence if higher
      if (args.confidence > existing.confidence) {
        await ctx.db.patch(existing._id, {
          confidence: args.confidence,
        });
      }
      return existing._id;
    }

    // Create new link
    const id = await ctx.db.insert("entity_links", {
      user_id: args.userId,
      from_entity: args.fromEntity,
      to_entity: args.toEntity,
      relationship: args.relationship,
      confidence: args.confidence,
      source_memory: args.sourceMemory,
      created_at: Date.now(),
    });

    return id;
  },
});

// Get relationships for an entity
export const getRelationships = query({
  args: {
    entityId: v.id("entities"),
    direction: v.optional(v.string()), // "outgoing" | "incoming" | "both"
  },
  handler: async (ctx, args) => {
    const direction = args.direction || "both";
    const results: any[] = [];

    if (direction === "outgoing" || direction === "both") {
      const outgoing = await ctx.db
        .query("entity_links")
        .withIndex("by_from", (q) => q.eq("from_entity", args.entityId))
        .collect();

      for (const link of outgoing) {
        const target = await ctx.db.get(link.to_entity);
        results.push({
          ...link,
          direction: "outgoing",
          relatedEntity: target,
        });
      }
    }

    if (direction === "incoming" || direction === "both") {
      const incoming = await ctx.db
        .query("entity_links")
        .withIndex("by_to", (q) => q.eq("to_entity", args.entityId))
        .collect();

      for (const link of incoming) {
        const source = await ctx.db.get(link.from_entity);
        results.push({
          ...link,
          direction: "incoming",
          relatedEntity: source,
        });
      }
    }

    return results;
  },
});

// =============================================================================
// MEMORY-ENTITY LINKS
// =============================================================================

// Link a memory to an entity
export const linkMemoryToEntity = mutation({
  args: {
    memoryId: v.id("memories"),
    entityId: v.id("entities"),
    role: v.string(), // "subject" | "object" | "mentioned"
  },
  handler: async (ctx, args) => {
    // Check if link already exists
    const existing = await ctx.db
      .query("memory_entities")
      .withIndex("by_memory", (q) => q.eq("memory_id", args.memoryId))
      .filter((q) => q.eq(q.field("entity_id"), args.entityId))
      .first();

    if (existing) {
      return existing._id;
    }

    const id = await ctx.db.insert("memory_entities", {
      memory_id: args.memoryId,
      entity_id: args.entityId,
      role: args.role,
      created_at: Date.now(),
    });

    return id;
  },
});

// Batch link memories to entities
export const linkMemoryToEntitiesBatch = mutation({
  args: {
    memoryId: v.id("memories"),
    entities: v.array(
      v.object({
        entityId: v.id("entities"),
        role: v.string(),
      })
    ),
  },
  handler: async (ctx, args) => {
    const created: string[] = [];

    for (const entity of args.entities) {
      // Check if link already exists
      const existing = await ctx.db
        .query("memory_entities")
        .withIndex("by_memory", (q) => q.eq("memory_id", args.memoryId))
        .filter((q) => q.eq(q.field("entity_id"), entity.entityId))
        .first();

      if (!existing) {
        const id = await ctx.db.insert("memory_entities", {
          memory_id: args.memoryId,
          entity_id: entity.entityId,
          role: entity.role,
          created_at: Date.now(),
        });
        created.push(id);
      }
    }

    return { created: created.length };
  },
});

// Get entities for a memory
export const getEntitiesForMemory = query({
  args: {
    memoryId: v.id("memories"),
  },
  handler: async (ctx, args) => {
    const links = await ctx.db
      .query("memory_entities")
      .withIndex("by_memory", (q) => q.eq("memory_id", args.memoryId))
      .collect();

    const entities = await Promise.all(
      links.map(async (link) => {
        const entity = await ctx.db.get(link.entity_id);
        return entity ? { ...entity, role: link.role } : null;
      })
    );

    return entities.filter((e) => e !== null);
  },
});

// Get memories for an entity
export const getMemoriesForEntity = query({
  args: {
    entityId: v.id("entities"),
    limit: v.optional(v.float64()),
  },
  handler: async (ctx, args) => {
    const links = await ctx.db
      .query("memory_entities")
      .withIndex("by_entity", (q) => q.eq("entity_id", args.entityId))
      .collect();

    const memories = await Promise.all(
      links.map(async (link) => {
        const memory = await ctx.db.get(link.memory_id);
        return memory ? { ...memory, role: link.role } : null;
      })
    );

    const validMemories = memories.filter((m) => m !== null && !m.is_forgotten);

    // Sort by created_at descending
    validMemories.sort((a, b) => (b?.created_at || 0) - (a?.created_at || 0));

    return validMemories.slice(0, args.limit || 50);
  },
});

// =============================================================================
// GRAPH QUERIES
// =============================================================================

// Get full entity graph for a user
export const getGraph = query({
  args: {
    userId: v.string(),
    limit: v.optional(v.float64()),
  },
  handler: async (ctx, args) => {
    // Get all entities
    const entities = await ctx.db
      .query("entities")
      .withIndex("by_user", (q) => q.eq("user_id", args.userId))
      .collect();

    // Sort by mention count and limit
    entities.sort((a, b) => (b.mention_count || 0) - (a.mention_count || 0));
    const topEntities = entities.slice(0, args.limit || 100);
    const entityIds = new Set(topEntities.map((e) => e._id));

    // Get all links between these entities
    const allLinks = await ctx.db
      .query("entity_links")
      .withIndex("by_user", (q) => q.eq("user_id", args.userId))
      .collect();

    // Filter to links between our top entities
    const links = allLinks.filter(
      (l) => entityIds.has(l.from_entity) && entityIds.has(l.to_entity)
    );

    return {
      nodes: topEntities.map((e) => ({
        id: e._id,
        name: e.name,
        type: e.entity_type,
        mentionCount: e.mention_count,
      })),
      edges: links.map((l) => ({
        id: l._id,
        from: l.from_entity,
        to: l.to_entity,
        relationship: l.relationship,
        confidence: l.confidence,
      })),
    };
  },
});

// Get entity stats for a user
export const getStats = query({
  args: {
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    const entities = await ctx.db
      .query("entities")
      .withIndex("by_user", (q) => q.eq("user_id", args.userId))
      .collect();

    const links = await ctx.db
      .query("entity_links")
      .withIndex("by_user", (q) => q.eq("user_id", args.userId))
      .collect();

    // Count by type
    const byType: Record<string, number> = {};
    for (const e of entities) {
      byType[e.entity_type] = (byType[e.entity_type] || 0) + 1;
    }

    // Count by relationship
    const byRelationship: Record<string, number> = {};
    for (const l of links) {
      byRelationship[l.relationship] = (byRelationship[l.relationship] || 0) + 1;
    }

    return {
      totalEntities: entities.length,
      totalRelationships: links.length,
      byType,
      byRelationship,
    };
  },
});
