import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

/**
 * Memory Links - Aethene relationship graph between memories
 *
 * Link types:
 * - supersedes: New memory replaces outdated information (job changes, location changes)
 * - enriches: New memory adds detail to an existing memory
 * - inferred: System derives new insight from patterns across memories
 */

// Create a link between two memories
export const createLink = mutation({
  args: {
    fromMemory: v.id("memories"),
    toMemory: v.id("memories"),
    linkType: v.string(),
    confidence: v.float64(),
  },
  handler: async (ctx, args) => {
    // Validate link type
    const validTypes = ["supersedes", "enriches", "inferred"];
    if (!validTypes.includes(args.linkType)) {
      throw new Error(`Invalid link type: ${args.linkType}. Must be one of: ${validTypes.join(", ")}`);
    }

    // Validate confidence range
    if (args.confidence < 0 || args.confidence > 1) {
      throw new Error("Confidence must be between 0 and 1");
    }

    // Verify both memories exist
    const fromMemory = await ctx.db.get(args.fromMemory);
    const toMemory = await ctx.db.get(args.toMemory);

    if (!fromMemory) {
      throw new Error(`Source memory not found: ${args.fromMemory}`);
    }
    if (!toMemory) {
      throw new Error(`Target memory not found: ${args.toMemory}`);
    }

    // Check for duplicate link
    const existing = await ctx.db
      .query("memory_links")
      .withIndex("by_from", (q) => q.eq("from_memory", args.fromMemory))
      .filter((q) => q.eq(q.field("to_memory"), args.toMemory))
      .first();

    if (existing) {
      // Update existing link
      await ctx.db.patch(existing._id, {
        link_type: args.linkType,
        confidence: args.confidence,
        created_at: Date.now(),
      });
      return existing._id;
    }

    // Create new link
    const id = await ctx.db.insert("memory_links", {
      from_memory: args.fromMemory,
      to_memory: args.toMemory,
      link_type: args.linkType,
      confidence: args.confidence,
      created_at: Date.now(),
    });

    return id;
  },
});

// Set a memory as forgotten (soft delete)
export const setMemoryForgotten = mutation({
  args: {
    memoryId: v.id("memories"),
    forgotten: v.boolean(),
  },
  handler: async (ctx, args) => {
    const memory = await ctx.db.get(args.memoryId);
    if (!memory) {
      throw new Error("Memory not found");
    }

    await ctx.db.patch(args.memoryId, {
      is_forgotten: args.forgotten,
      forgotten: args.forgotten,
      updated_at: Date.now(),
    });

    return { success: true };
  },
});

// Set memory expiry for auto-forget
export const setMemoryExpiry = mutation({
  args: {
    memoryId: v.id("memories"),
    expiresAt: v.optional(v.float64()),
  },
  handler: async (ctx, args) => {
    const memory = await ctx.db.get(args.memoryId);
    if (!memory) {
      throw new Error("Memory not found");
    }

    await ctx.db.patch(args.memoryId, {
      expires_at: args.expiresAt,
      updated_at: Date.now(),
    });

    return { success: true };
  },
});

// Update memory kind (fact, preference, event)
export const setMemoryKind = mutation({
  args: {
    memoryId: v.id("memories"),
    kind: v.string(),
  },
  handler: async (ctx, args) => {
    const validKinds = ["fact", "preference", "event"];
    if (!validKinds.includes(args.kind)) {
      throw new Error(`Invalid memory kind: ${args.kind}. Must be one of: ${validKinds.join(", ")}`);
    }

    const memory = await ctx.db.get(args.memoryId);
    if (!memory) {
      throw new Error("Memory not found");
    }

    await ctx.db.patch(args.memoryId, {
      memory_kind: args.kind,
      updated_at: Date.now(),
    });

    return { success: true };
  },
});

// Get all links originating from a memory
export const getLinksBySource = query({
  args: {
    memoryId: v.id("memories"),
    linkType: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    let links = await ctx.db
      .query("memory_links")
      .withIndex("by_from", (q) => q.eq("from_memory", args.memoryId))
      .collect();

    // Filter by type if specified
    if (args.linkType) {
      links = links.filter((l) => l.link_type === args.linkType);
    }

    // Enrich with target memory content
    const enrichedLinks = await Promise.all(
      links.map(async (link) => {
        const targetMemory = await ctx.db.get(link.to_memory);
        return {
          ...link,
          target_content: targetMemory?.content || null,
          target_is_forgotten: targetMemory?.is_forgotten || false,
        };
      })
    );

    return enrichedLinks;
  },
});

// Get all links pointing to a memory
export const getLinksByTarget = query({
  args: {
    memoryId: v.id("memories"),
    linkType: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    let links = await ctx.db
      .query("memory_links")
      .withIndex("by_to", (q) => q.eq("to_memory", args.memoryId))
      .collect();

    // Filter by type if specified
    if (args.linkType) {
      links = links.filter((l) => l.link_type === args.linkType);
    }

    // Enrich with source memory content
    const enrichedLinks = await Promise.all(
      links.map(async (link) => {
        const sourceMemory = await ctx.db.get(link.from_memory);
        return {
          ...link,
          source_content: sourceMemory?.content || null,
          source_is_forgotten: sourceMemory?.is_forgotten || false,
        };
      })
    );

    return enrichedLinks;
  },
});

// Get memories that supersede a given memory
export const getSupersedingMemories = query({
  args: {
    memoryId: v.id("memories"),
  },
  handler: async (ctx, args) => {
    const links = await ctx.db
      .query("memory_links")
      .withIndex("by_to", (q) => q.eq("to_memory", args.memoryId))
      .filter((q) => q.eq(q.field("link_type"), "supersedes"))
      .collect();

    const memories = await Promise.all(
      links.map(async (link) => {
        const memory = await ctx.db.get(link.from_memory);
        return memory ? { ...memory, link_confidence: link.confidence } : null;
      })
    );

    return memories.filter((m) => m !== null);
  },
});

// Get memories that are superseded by a given memory
export const getSupersededMemories = query({
  args: {
    memoryId: v.id("memories"),
  },
  handler: async (ctx, args) => {
    const links = await ctx.db
      .query("memory_links")
      .withIndex("by_from", (q) => q.eq("from_memory", args.memoryId))
      .filter((q) => q.eq(q.field("link_type"), "supersedes"))
      .collect();

    const memories = await Promise.all(
      links.map(async (link) => {
        const memory = await ctx.db.get(link.to_memory);
        return memory ? { ...memory, link_confidence: link.confidence } : null;
      })
    );

    return memories.filter((m) => m !== null);
  },
});

// Delete a link
export const deleteLink = mutation({
  args: {
    linkId: v.id("memory_links"),
  },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.linkId);
    return { success: true };
  },
});

// Delete all links for a memory (cleanup when deleting memory)
export const deleteLinksForMemory = mutation({
  args: {
    memoryId: v.id("memories"),
  },
  handler: async (ctx, args) => {
    // Delete outgoing links
    const outgoing = await ctx.db
      .query("memory_links")
      .withIndex("by_from", (q) => q.eq("from_memory", args.memoryId))
      .collect();

    for (const link of outgoing) {
      await ctx.db.delete(link._id);
    }

    // Delete incoming links
    const incoming = await ctx.db
      .query("memory_links")
      .withIndex("by_to", (q) => q.eq("to_memory", args.memoryId))
      .collect();

    for (const link of incoming) {
      await ctx.db.delete(link._id);
    }

    return { deleted: outgoing.length + incoming.length };
  },
});

// Get expired memories for cleanup
export const getExpiredMemories = query({
  args: {
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Get memories with expiry set
    const memories = await ctx.db
      .query("memories")
      .withIndex("by_user", (q) => q.eq("user_id", args.userId))
      .filter((q) =>
        q.and(
          q.neq(q.field("expires_at"), undefined),
          q.lt(q.field("expires_at"), now),
          q.eq(q.field("is_forgotten"), false)
        )
      )
      .collect();

    return memories;
  },
});

// Batch create links
export const createLinks = mutation({
  args: {
    links: v.array(
      v.object({
        fromMemory: v.id("memories"),
        toMemory: v.id("memories"),
        linkType: v.string(),
        confidence: v.float64(),
      })
    ),
  },
  handler: async (ctx, args) => {
    const validTypes = ["supersedes", "enriches", "inferred"];
    const created: string[] = [];

    for (const link of args.links) {
      // Validate
      if (!validTypes.includes(link.linkType)) {
        continue;
      }
      if (link.confidence < 0 || link.confidence > 1) {
        continue;
      }

      // Create link
      const id = await ctx.db.insert("memory_links", {
        from_memory: link.fromMemory,
        to_memory: link.toMemory,
        link_type: link.linkType,
        confidence: link.confidence,
        created_at: Date.now(),
      });

      created.push(id);
    }

    return { created: created.length };
  },
});
