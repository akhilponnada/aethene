import { v } from "convex/values";
import { mutation, query, internalMutation } from "./_generated/server";

/**
 * Memory Operations - Advanced memory manipulation functions
 */

// =============================================================================
// CREATE MEMORY DIRECTLY
// =============================================================================

/**
 * Create a memory directly, bypassing extraction pipeline.
 * Used by memory-operations.ts service.
 */
export const createDirect = mutation({
  args: {
    userId: v.string(),
    content: v.string(),
    isCore: v.optional(v.boolean()),
    sourceDocument: v.optional(v.string()),
    metadata: v.optional(v.any()),
    embedding: v.optional(v.array(v.float64())),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Validate content length
    if (args.content.length > 10000) {
      throw new Error("Content exceeds maximum length of 10000 characters");
    }

    const id = await ctx.db.insert("memories", {
      user_id: args.userId,
      content: args.content,
      is_core: args.isCore ?? false,
      is_latest: true,
      is_forgotten: false,
      version: 1,
      previous_version: undefined,
      source_document: args.sourceDocument,
      metadata: args.metadata,
      embedding: args.embedding,
      created_at: now,
      updated_at: now,
    });

    return id;
  },
});

// =============================================================================
// FORGET MEMORY (SOFT DELETE)
// =============================================================================

/**
 * Soft delete a memory for GDPR compliance.
 * Memory is excluded from search but preserved in database.
 */
export const forgetMemory = mutation({
  args: {
    id: v.id("memories"),
    userId: v.string(), // For ownership verification
  },
  handler: async (ctx, args) => {
    const memory = await ctx.db.get(args.id);

    if (!memory) {
      throw new Error("Memory not found");
    }

    if (memory.user_id !== args.userId) {
      throw new Error("Access denied: you do not own this memory");
    }

    if (memory.is_forgotten) {
      return { success: true, message: "Already forgotten" };
    }

    await ctx.db.patch(args.id, {
      is_forgotten: true,
      updated_at: Date.now(),
    });

    return { success: true };
  },
});

// =============================================================================
// RESTORE MEMORY
// =============================================================================

/**
 * Restore a forgotten memory.
 */
export const restore = mutation({
  args: {
    id: v.id("memories"),
  },
  handler: async (ctx, args) => {
    const memory = await ctx.db.get(args.id);

    if (!memory) {
      throw new Error("Memory not found");
    }

    if (!memory.is_forgotten) {
      return { success: true, message: "Memory is not forgotten" };
    }

    await ctx.db.patch(args.id, {
      is_forgotten: false,
      updated_at: Date.now(),
    });

    return { success: true };
  },
});

// =============================================================================
// CREATE MEMORY VERSION
// =============================================================================

/**
 * Create a new version of an existing memory.
 * Marks old version as superseded and links to it.
 */
export const createVersion = mutation({
  args: {
    previousId: v.id("memories"),
    content: v.string(),
    metadata: v.optional(v.any()),
    embedding: v.optional(v.array(v.float64())),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.previousId);

    if (!existing) {
      throw new Error("Previous memory version not found");
    }

    if (existing.is_forgotten) {
      throw new Error("Cannot create version of a forgotten memory");
    }

    // Validate content length
    if (args.content.length > 10000) {
      throw new Error("Content exceeds maximum length of 10000 characters");
    }

    const now = Date.now();

    // Mark old version as superseded
    await ctx.db.patch(args.previousId, {
      is_latest: false,
      updated_at: now,
    });

    // Create new version
    const newId = await ctx.db.insert("memories", {
      user_id: existing.user_id,
      content: args.content,
      is_core: existing.is_core,
      is_latest: true,
      is_forgotten: false,
      version: existing.version + 1,
      previous_version: args.previousId,
      source_document: existing.source_document,
      metadata: args.metadata ?? existing.metadata,
      embedding: args.embedding,
      created_at: now,
      updated_at: now,
    });

    return {
      newId,
      previousId: args.previousId,
      version: existing.version + 1,
    };
  },
});

// =============================================================================
// BATCH CREATE MEMORIES
// =============================================================================

/**
 * Create multiple memories at once (more efficient than individual inserts).
 */
export const batchCreate = mutation({
  args: {
    memories: v.array(
      v.object({
        userId: v.string(),
        content: v.string(),
        isCore: v.optional(v.boolean()),
        sourceDocument: v.optional(v.string()),
        metadata: v.optional(v.any()),
        embedding: v.optional(v.array(v.float64())),
      })
    ),
  },
  handler: async (ctx, args) => {
    // Rate limit
    if (args.memories.length > 100) {
      throw new Error("Maximum 100 memories per batch");
    }

    const now = Date.now();
    const ids: string[] = [];

    for (const memory of args.memories) {
      // Validate content length
      if (memory.content.length > 10000) {
        continue; // Skip invalid memories
      }

      const id = await ctx.db.insert("memories", {
        user_id: memory.userId,
        content: memory.content,
        is_core: memory.isCore ?? false,
        is_latest: true,
        is_forgotten: false,
        version: 1,
        previous_version: undefined,
        source_document: memory.sourceDocument,
        metadata: memory.metadata,
        embedding: memory.embedding,
        created_at: now,
        updated_at: now,
      });

      ids.push(id);
    }

    return ids;
  },
});

// =============================================================================
// BATCH FORGET MEMORIES
// =============================================================================

/**
 * Forget multiple memories at once.
 */
export const batchForget = mutation({
  args: {
    userId: v.string(),
    ids: v.array(v.id("memories")),
  },
  handler: async (ctx, args) => {
    // Rate limit
    if (args.ids.length > 100) {
      throw new Error("Maximum 100 memories per batch forget");
    }

    const now = Date.now();
    const forgotten: string[] = [];
    const errors: Array<{ id: string; error: string }> = [];

    for (const id of args.ids) {
      try {
        const memory = await ctx.db.get(id);

        if (!memory) {
          errors.push({ id, error: "Memory not found" });
          continue;
        }

        if (memory.user_id !== args.userId) {
          errors.push({ id, error: "Access denied" });
          continue;
        }

        if (memory.is_forgotten) {
          forgotten.push(id); // Already forgotten, count as success
          continue;
        }

        await ctx.db.patch(id, {
          is_forgotten: true,
          updated_at: now,
        });

        forgotten.push(id);
      } catch (e: any) {
        errors.push({ id, error: e.message });
      }
    }

    return { forgotten, errors };
  },
});

// =============================================================================
// GET MEMORY BY USER (WITH FILTERING)
// =============================================================================

/**
 * Get memories for a user with optional filtering.
 */
export const getByUserFiltered = query({
  args: {
    userId: v.string(),
    isCore: v.optional(v.boolean()),
    isForgotten: v.optional(v.boolean()),
    isLatest: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 50, 100);
    const isForgotten = args.isForgotten ?? false;
    const isLatest = args.isLatest ?? true;

    let memories;

    // Use appropriate index based on filter
    if (args.isCore !== undefined) {
      memories = await ctx.db
        .query("memories")
        .withIndex("by_user_core", (q) =>
          q.eq("user_id", args.userId).eq("is_core", args.isCore!)
        )
        .order("desc")
        .take(limit * 2);
    } else {
      memories = await ctx.db
        .query("memories")
        .withIndex("by_user", (q) => q.eq("user_id", args.userId))
        .order("desc")
        .take(limit * 2);
    }

    // Apply client-side filters
    return memories
      .filter((m) => m.is_forgotten === isForgotten)
      .filter((m) => !isLatest || m.is_latest)
      .slice(0, limit);
  },
});

// =============================================================================
// GET MEMORY STATS
// =============================================================================

/**
 * Get memory statistics for a user.
 */
export const getStats = query({
  args: {
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    const allMemories = await ctx.db
      .query("memories")
      .withIndex("by_user", (q) => q.eq("user_id", args.userId))
      .collect();

    const total = allMemories.length;
    const core = allMemories.filter((m) => m.is_core && !m.is_forgotten).length;
    const recent = allMemories.filter((m) => !m.is_core && !m.is_forgotten).length;
    const forgotten = allMemories.filter((m) => m.is_forgotten).length;
    const versioned = allMemories.filter((m) => m.version > 1).length;
    const latest = allMemories.filter((m) => m.is_latest && !m.is_forgotten).length;

    return {
      total,
      core,
      recent,
      forgotten,
      versioned,
      active: latest,
    };
  },
});

// =============================================================================
// PERMANENTLY DELETE MEMORY
// =============================================================================

/**
 * Permanently delete a memory (use with caution).
 * Typically used for regulatory compliance when soft delete isn't sufficient.
 */
export const permanentDelete = mutation({
  args: {
    id: v.id("memories"),
    userId: v.string(), // For ownership verification
  },
  handler: async (ctx, args) => {
    const memory = await ctx.db.get(args.id);

    if (!memory) {
      throw new Error("Memory not found");
    }

    if (memory.user_id !== args.userId) {
      throw new Error("Access denied: you do not own this memory");
    }

    await ctx.db.delete(args.id);

    return { success: true };
  },
});

// =============================================================================
// SEARCH MEMORIES (NON-VECTOR)
// =============================================================================

/**
 * Search memories by content (substring match).
 * For vector search, use vectorSearch.ts.
 */
export const searchByContent = query({
  args: {
    userId: v.string(),
    query: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 20, 50);
    const queryLower = args.query.toLowerCase();

    const memories = await ctx.db
      .query("memories")
      .withIndex("by_user", (q) => q.eq("user_id", args.userId))
      .order("desc")
      .take(500); // Fetch more to search through

    // Client-side content search
    const matches = memories
      .filter((m) => !m.is_forgotten && m.is_latest)
      .filter((m) => m.content.toLowerCase().includes(queryLower))
      .slice(0, limit);

    return matches;
  },
});

// =============================================================================
// CLEANUP EXPIRED MEMORIES (CRON)
// =============================================================================

/**
 * Internal mutation called by cron job to clean up expired memories.
 * Marks memories with expires_at in the past as forgotten.
 */
export const cleanupExpiredMemories = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();

    // Query all memories with expires_at set
    // We need to scan since we can't directly query "expires_at < now"
    const memoriesWithExpiry = await ctx.db
      .query("memories")
      .filter((q) =>
        q.and(
          q.neq(q.field("expires_at"), undefined),
          q.eq(q.field("is_forgotten"), false)
        )
      )
      .take(1000);

    const expiredMemories = memoriesWithExpiry.filter(
      (m) => m.expires_at !== undefined && m.expires_at < now
    );

    // Mark expired memories as forgotten
    for (const memory of expiredMemories) {
      await ctx.db.patch(memory._id, {
        is_forgotten: true,
        forgotten: true, // Alias field
        updated_at: now,
      });
    }

    return {
      checked: memoriesWithExpiry.length,
      expired: expiredMemories.length,
      timestamp: now,
    };
  },
});

// =============================================================================
// GET EXPIRING MEMORIES
// =============================================================================

/**
 * Get memories that are expiring soon (within specified hours).
 * Useful for showing users what memories will be auto-forgotten.
 */
export const getExpiringMemories = query({
  args: {
    userId: v.string(),
    withinHours: v.optional(v.number()), // Default 24 hours
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 50, 100);
    const hoursAhead = args.withinHours ?? 24;
    const now = Date.now();
    const cutoff = now + (hoursAhead * 60 * 60 * 1000);

    // Get user's memories with expiry
    const memories = await ctx.db
      .query("memories")
      .withIndex("by_user", (q) => q.eq("user_id", args.userId))
      .filter((q) =>
        q.and(
          q.neq(q.field("expires_at"), undefined),
          q.eq(q.field("is_forgotten"), false),
          q.eq(q.field("is_latest"), true)
        )
      )
      .take(limit * 2);

    // Filter to memories expiring within the window
    const expiring = memories
      .filter((m) => m.expires_at !== undefined && m.expires_at > now && m.expires_at <= cutoff)
      .sort((a, b) => (a.expires_at ?? 0) - (b.expires_at ?? 0))
      .slice(0, limit);

    return expiring.map((m) => ({
      id: m._id,
      content: m.content,
      expiresAt: m.expires_at,
      expiresIn: m.expires_at ? m.expires_at - now : null,
      memoryKind: m.memory_kind,
      createdAt: m.created_at,
    }));
  },
});

// =============================================================================
// SET MEMORY EXPIRATION
// =============================================================================

/**
 * Set or update the expiration time for a memory.
 * Can also be used to remove expiration (set to null).
 */
export const setExpiration = mutation({
  args: {
    id: v.id("memories"),
    userId: v.string(),
    expiresAt: v.optional(v.float64()), // Unix timestamp or null to remove
  },
  handler: async (ctx, args) => {
    const memory = await ctx.db.get(args.id);

    if (!memory) {
      throw new Error("Memory not found");
    }

    if (memory.user_id !== args.userId) {
      throw new Error("Access denied: you do not own this memory");
    }

    if (memory.is_forgotten) {
      throw new Error("Cannot set expiration on a forgotten memory");
    }

    await ctx.db.patch(args.id, {
      expires_at: args.expiresAt,
      updated_at: Date.now(),
    });

    return {
      success: true,
      expiresAt: args.expiresAt,
    };
  },
});

// =============================================================================
// GET MEMORIES BY KIND
// =============================================================================

/**
 * Get memories filtered by kind (fact, preference, event).
 */
export const getByKind = query({
  args: {
    userId: v.string(),
    kind: v.string(), // 'fact' | 'preference' | 'event'
    limit: v.optional(v.number()),
    includeExpired: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 50, 100);
    const now = Date.now();

    const memories = await ctx.db
      .query("memories")
      .withIndex("by_user_kind", (q) =>
        q.eq("user_id", args.userId).eq("memory_kind", args.kind)
      )
      .filter((q) =>
        q.and(
          q.eq(q.field("is_forgotten"), false),
          q.eq(q.field("is_latest"), true)
        )
      )
      .order("desc")
      .take(limit * 2);

    // Filter out expired unless requested
    let filtered = memories;
    if (!args.includeExpired) {
      filtered = memories.filter(
        (m) => !m.expires_at || m.expires_at > now
      );
    }

    return filtered.slice(0, limit);
  },
});

// =============================================================================
// GET MEMORY EXPIRY STATS
// =============================================================================

/**
 * Get statistics about memory expiration for a user.
 */
export const getExpiryStats = query({
  args: {
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const oneDay = 24 * 60 * 60 * 1000;
    const oneWeek = 7 * oneDay;

    const memories = await ctx.db
      .query("memories")
      .withIndex("by_user", (q) => q.eq("user_id", args.userId))
      .filter((q) =>
        q.and(
          q.eq(q.field("is_forgotten"), false),
          q.eq(q.field("is_latest"), true)
        )
      )
      .collect();

    const withExpiry = memories.filter((m) => m.expires_at !== undefined);
    const expiringToday = withExpiry.filter(
      (m) => m.expires_at! > now && m.expires_at! <= now + oneDay
    );
    const expiringThisWeek = withExpiry.filter(
      (m) => m.expires_at! > now && m.expires_at! <= now + oneWeek
    );
    const alreadyExpired = withExpiry.filter(
      (m) => m.expires_at! <= now
    );

    // Count by kind
    const byKind = {
      fact: memories.filter((m) => m.memory_kind === "fact").length,
      preference: memories.filter((m) => m.memory_kind === "preference").length,
      event: memories.filter((m) => m.memory_kind === "event").length,
      unknown: memories.filter((m) => !m.memory_kind).length,
    };

    return {
      total: memories.length,
      withExpiry: withExpiry.length,
      permanent: memories.length - withExpiry.length,
      expiringToday: expiringToday.length,
      expiringThisWeek: expiringThisWeek.length,
      alreadyExpired: alreadyExpired.length,
      byKind,
    };
  },
});
