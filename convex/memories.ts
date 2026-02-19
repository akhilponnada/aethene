import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

/**
 * Memories - Core memory operations with versioning
 */

// Normalize content for deduplication
function normalizeContent(content: string): string {
  return content
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Extract the core fact without subject prefix
function extractCoreFact(content: string): string {
  const normalized = normalizeContent(content);
  // Remove "user" or "users" or name patterns at start
  // Patterns: "user loves X", "alex chen loves X", "john smith is X"
  const withoutSubject = normalized
    .replace(/^users?\s+/, '')  // Remove "user" or "users"
    .replace(/^[a-z]+\s+[a-z]+\s+/, '')  // Remove "first last " (2-word names)
    .replace(/^[a-z]+s?\s+/, '');  // Remove single word + 's or space
  return withoutSubject;
}

// Check if two memories are contradictions (same property, different value)
// Returns the property being updated if it's a contradiction, null otherwise
function detectContradiction(newContent: string, existingContent: string): string | null {
  const newNorm = normalizeContent(newContent);
  const existNorm = normalizeContent(existingContent);

  // Check if new content indicates an update ("now", "updated", "changed", "new", "grew", "expanded", "increased")
  const isUpdate = /\b(now|updated|changed|new|revised|current|grew|expanded|increased|decreased|became)\b/.test(newNorm);

  // Patterns that indicate the same property being stated differently
  // Note: patterns should handle optional "users" prefix from normalization
  const propertyPatterns = [
    // "favorite X is Y" or "favorite X is now Y" patterns
    {
      regex: /favorite\s+(\w+)\s+is\s+(?:now\s+)?(\w+)/,
      property: (m: RegExpMatchArray) => `favorite_${m[1]}`
    },
    // "lives in X" patterns
    { regex: /lives?\s+in\s+(\w+)/, property: () => 'location' },
    // "works at X" patterns
    { regex: /works?\s+at\s+(\w+)/, property: () => 'workplace' },
    // "name is X" patterns
    { regex: /name\s+is\s+(\w+)/, property: () => 'name' },
    // "is X years old" patterns
    { regex: /is\s+(\d+)\s+years?\s+old/, property: () => 'age' },
    // Revenue/sales/profit target patterns - "$XM revenue target", "revenue target is $X"
    { regex: /(?:revenue|sales|profit)\s+(?:target|goal)/, property: () => 'revenue_target' },
    { regex: /\$[\d.,]+[KMB]?\s+(?:revenue|sales|profit)\s+(?:target|goal)/, property: () => 'revenue_target' },
    { regex: /(?:q[1-4]|quarterly|annual|yearly)\s+(?:revenue|sales|target|goal)/i, property: () => 'revenue_target' },
    // Generic target/goal patterns
    { regex: /(\w+)\s+target\s+(?:is|was|of)\s+/, property: (m: RegExpMatchArray) => `${m[1]}_target` },
    // Budget patterns
    { regex: /budget\s+(?:is|was|of)\s+\$/, property: () => 'budget' },
    // Headcount/team size patterns
    { regex: /(?:team\s+size|headcount)\s+(?:is|was|of)?\s*(\d+)/, property: () => 'team_size' },
    // Salary/compensation patterns
    { regex: /(?:salary|compensation|pay)\s+(?:is|was|of)?\s*\$/, property: () => 'salary' },
    // Customer count patterns - "customer count 500", "customer count updated to 750", "X customers"
    { regex: /customer\s+count\s+(?:is|was|of|updated\s+to|grew\s+to|expanded\s+to)?\s*(\d+)/, property: () => 'customer_count' },
    { regex: /(\d+)\s+customers?/, property: () => 'customer_count' },
    // Generic "X count" patterns
    { regex: /(\w+)\s+count\s+(?:is|was|of|updated\s+to)?\s*(\d+)/, property: (m: RegExpMatchArray) => `${m[1]}_count` },
    // Employee count patterns
    { regex: /(?:employee|staff|worker)\s+count\s+(?:is|was|of)?\s*(\d+)/, property: () => 'employee_count' },
    { regex: /(\d+)\s+(?:employees?|staff|workers?)/, property: () => 'employee_count' },
  ];

  for (const pattern of propertyPatterns) {
    const newMatch = newNorm.match(pattern.regex);
    const existMatch = existNorm.match(pattern.regex);

    if (newMatch && existMatch) {
      const newProp = pattern.property(newMatch);
      const existProp = pattern.property(existMatch);

      // Same property type - check if values are different
      if (newProp === existProp) {
        // For numeric/monetary values, always check if they differ
        // Extract numeric values from both strings for comparison
        const newNumbers = newNorm.match(/\$?[\d.,]+[KMB]?/g) || [];
        const existNumbers = existNorm.match(/\$?[\d.,]+[KMB]?/g) || [];

        // If there are numbers and they differ, it's a contradiction
        if (newNumbers.length > 0 && existNumbers.length > 0) {
          const newVal = newNumbers[0].replace(/[$,]/g, '');
          const existVal = existNumbers[0].replace(/[$,]/g, '');
          if (newVal !== existVal) {
            return newProp;
          }
        }

        // Fallback: if "now"/"updated" etc. is present, treat as contradiction
        if (isUpdate) {
          return newProp;
        }
      }
    }
  }

  return null;
}

// Create a new memory with deduplication
export const create = mutation({
  args: {
    userId: v.string(),
    content: v.string(),
    isCore: v.optional(v.boolean()),
    sourceDocument: v.optional(v.string()),
    containerTags: v.optional(v.array(v.string())),  // Inherited from source document
    metadata: v.optional(v.any()),
    embedding: v.optional(v.array(v.float64())),
    // Auto-forgetting fields
    memoryKind: v.optional(v.string()),  // 'fact' | 'preference' | 'event'
    expiresAt: v.optional(v.float64()),  // Unix timestamp for auto-expiry
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const normalizedNew = normalizeContent(args.content);

    console.log(`[memories:create] Content: "${args.content.substring(0, 50)}..." Normalized: "${normalizedNew}"`);

    // Skip empty content
    if (!normalizedNew || normalizedNew.length < 5) {
      console.log(`[memories:create] SKIP - content too short`);
      return null;
    }

    // Check for existing similar memories for this user
    const existingMemories = await ctx.db
      .query("memories")
      .withIndex("by_user", (q) => q.eq("user_id", args.userId))
      .filter((q) => q.eq(q.field("is_forgotten"), false))
      .take(200);

    console.log(`[memories:create] Found ${existingMemories.length} existing memories for user ${args.userId}`);

    // Check for duplicates and contradictions
    let contradictedMemory: any = null;
    for (const existing of existingMemories) {
      const normalizedExisting = normalizeContent(existing.content);

      // Check container overlap FIRST (for both dedup and contradiction)
      const newHasTags = args.containerTags && args.containerTags.length > 0;
      const existingHasTags = existing.container_tags && existing.container_tags.length > 0;
      const sameContainer =
        // Both have tags and at least one matches
        (newHasTags && existingHasTags && args.containerTags!.some(tag => existing.container_tags!.includes(tag))) ||
        // Neither has tags (global scope)
        (!newHasTags && !existingHasTags);

      // Exact match only - skip (dedup) - BUT only within same container!
      if (normalizedNew === normalizedExisting && sameContainer) {
        console.log(`[memories:create] DEDUP - found match in same container: "${existing.content.substring(0, 50)}..."`);
        return existing._id;
      }

      if (sameContainer && existing.is_latest) {
        const contradiction = detectContradiction(args.content, existing.content);
        if (contradiction) {
          console.log(`[memories:create] CONTRADICTION detected for property "${contradiction}"`);
          console.log(`  Old: "${existing.content.substring(0, 50)}..."`);
          console.log(`  New: "${args.content.substring(0, 50)}..."`);
          contradictedMemory = existing;
          break; // Handle one contradiction at a time
        }
      }
    }

    // If we found a contradiction, update the old memory and create new version
    if (contradictedMemory) {
      // Mark old memory as not latest
      await ctx.db.patch(contradictedMemory._id, {
        is_latest: false,
        updated_at: now,
      });
      console.log(`[memories:create] UPDATE - marking old memory as not latest`);

      // Create new memory with version chain
      const id = await ctx.db.insert("memories", {
        user_id: args.userId,
        content: args.content,
        is_core: args.isCore ?? false,
        is_latest: true,
        is_forgotten: false,
        version: (contradictedMemory.version || 1) + 1,
        previous_version: contradictedMemory._id,
        source_document: args.sourceDocument,
        container_tags: args.containerTags,
        metadata: args.metadata,
        embedding: args.embedding,
        created_at: now,
        updated_at: now,
        memory_kind: args.memoryKind,
        expires_at: args.expiresAt,
      });
      return id;
    }

    console.log(`[memories:create] CREATE - no duplicate or contradiction found`);
    // No duplicate or contradiction found, create new
    const id = await ctx.db.insert("memories", {
      user_id: args.userId,
      content: args.content,
      is_core: args.isCore ?? false,
      is_latest: true,
      is_forgotten: false,
      version: 1,
      previous_version: undefined,
      source_document: args.sourceDocument,
      container_tags: args.containerTags,
      metadata: args.metadata,
      embedding: args.embedding,
      created_at: now,
      updated_at: now,
      // Auto-forgetting fields
      memory_kind: args.memoryKind,
      expires_at: args.expiresAt,
    });

    return id;
  },
});

// Get memory by ID
export const get = query({
  args: { id: v.id("memories") },
  handler: async (ctx, args) => {
    return ctx.db.get(args.id);
  },
});

// Alias for getById (used by Express API)
export const getById = query({
  args: { id: v.id("memories") },
  handler: async (ctx, args) => {
    return ctx.db.get(args.id);
  },
});

// List memories for user
export const list = query({
  args: {
    userId: v.string(),
    limit: v.optional(v.number()),
    isCore: v.optional(v.boolean()),
    includeOldVersions: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;

    // Filter by is_core if specified
    if (args.isCore !== undefined) {
      const memories = await ctx.db
        .query("memories")
        .withIndex("by_user_core", (q) =>
          q.eq("user_id", args.userId).eq("is_core", args.isCore!)
        )
        .order("desc")
        .take(limit * 2); // Get extra to filter

      // Filter out old versions and forgotten unless requested
      return memories
        .filter((m) => !m.is_forgotten)
        .filter((m) => args.includeOldVersions || m.is_latest)
        .slice(0, limit);
    }

    // Get all memories
    const memories = await ctx.db
      .query("memories")
      .withIndex("by_user", (q) => q.eq("user_id", args.userId))
      .order("desc")
      .take(limit * 2);

    return memories
      .filter((m) => !m.is_forgotten)
      .filter((m) => args.includeOldVersions || m.is_latest)
      .slice(0, limit);
  },
});

// Update a memory (creates new version)
export const update = mutation({
  args: {
    id: v.id("memories"),
    content: v.string(),
    metadata: v.optional(v.any()),
    embedding: v.optional(v.array(v.float64())),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.id);
    if (!existing) {
      throw new Error("Memory not found");
    }

    const now = Date.now();

    // Mark old version as not latest
    await ctx.db.patch(args.id, {
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
      previous_version: args.id,
      source_document: existing.source_document,
      metadata: args.metadata ?? existing.metadata,
      embedding: args.embedding,
      created_at: now,
      updated_at: now,
    });

    return newId;
  },
});

// Forget a memory (soft delete for GDPR)
export const forget = mutation({
  args: { id: v.id("memories") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      is_forgotten: true,
      updated_at: Date.now(),
    });
    return { success: true };
  },
});

// Permanently delete a memory
export const remove = mutation({
  args: { id: v.id("memories") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
    return { success: true };
  },
});

// Get memories by user with core filter
export const getByUser = query({
  args: {
    userId: v.string(),
    isCore: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;

    let memories;
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

    // Filter out forgotten and old versions
    return memories
      .filter((m) => !m.is_forgotten && m.is_latest)
      .slice(0, limit);
  },
});

// Promote memory to core (permanent)
export const promoteToCore = mutation({
  args: { id: v.id("memories") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      is_core: true,
      updated_at: Date.now(),
    });
    return { success: true };
  },
});

// Demote memory from core (back to recent)
export const demoteFromCore = mutation({
  args: { id: v.id("memories") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      is_core: false,
      updated_at: Date.now(),
    });
    return { success: true };
  },
});

// Get version history for a memory
export const getVersionHistory = query({
  args: { id: v.id("memories") },
  handler: async (ctx, args) => {
    const history: any[] = [];
    let currentId: string | undefined = args.id;

    while (currentId) {
      const memory = await ctx.db.get(currentId as any);
      if (!memory) break;

      history.push(memory);
      currentId = memory.previous_version;
    }

    return history;
  },
});
