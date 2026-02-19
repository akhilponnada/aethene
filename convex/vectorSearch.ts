import { v } from "convex/values";
import { action, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";

/**
 * Vector Search - Semantic search across documents and memories
 */

// Internal queries for batch fetching
export const getDocumentsByIds = internalQuery({
  args: { ids: v.array(v.id("documents")) },
  handler: async (ctx, args) => {
    const docs = await Promise.all(args.ids.map((id) => ctx.db.get(id)));
    const docMap: Record<string, any> = {};
    for (let i = 0; i < args.ids.length; i++) {
      if (docs[i]) {
        docMap[args.ids[i]] = docs[i];
      }
    }
    return docMap;
  },
});

export const getChunksByIds = internalQuery({
  args: { ids: v.array(v.id("document_chunks")) },
  handler: async (ctx, args) => {
    const chunks = await Promise.all(args.ids.map((id) => ctx.db.get(id)));
    const chunkMap: Record<string, any> = {};
    for (let i = 0; i < args.ids.length; i++) {
      if (chunks[i]) {
        // Include all fields including container_tags for filtering
        chunkMap[args.ids[i]] = chunks[i];
      }
    }
    return chunkMap;
  },
});

export const getMemoriesByIds = internalQuery({
  args: { ids: v.array(v.id("memories")) },
  handler: async (ctx, args) => {
    const memories = await Promise.all(args.ids.map((id) => ctx.db.get(id)));
    const memoryMap: Record<string, any> = {};
    for (let i = 0; i < args.ids.length; i++) {
      if (memories[i]) {
        memoryMap[args.ids[i]] = memories[i];
      }
    }
    return memoryMap;
  },
});

// Search documents by vector similarity
export const searchDocuments = action({
  args: {
    userId: v.string(),
    embedding: v.array(v.float64()),
    limit: v.optional(v.number()),
    minScore: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 10;
    const minScore = args.minScore ?? 0.5;

    const results = await ctx.vectorSearch("documents", "by_embedding", {
      vector: args.embedding,
      limit,
      filter: (q) => q.eq("user_id", args.userId),
    });

    // Filter by minimum score
    const filteredIds = results
      .filter((r: any) => r._score >= minScore)
      .map((r: any) => r._id);

    if (filteredIds.length === 0) {
      return [];
    }

    // Batch fetch documents
    const docMap = await ctx.runQuery(internal.vectorSearch.getDocumentsByIds, {
      ids: filteredIds,
    });

    // Build results with full document data
    return results
      .filter((r: any) => r._score >= minScore && docMap[r._id])
      .map((r: any) => ({
        ...docMap[r._id],
        score: r._score,
      }));
  },
});

// Search chunks by vector similarity
export const searchChunks = action({
  args: {
    userId: v.string(),
    embedding: v.array(v.float64()),
    limit: v.optional(v.number()),
    minScore: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 10;
    const minScore = args.minScore ?? 0.5;

    const results = await ctx.vectorSearch("document_chunks", "by_embedding", {
      vector: args.embedding,
      limit,
      filter: (q) => q.eq("user_id", args.userId),
    });

    const filteredIds = results
      .filter((r: any) => r._score >= minScore)
      .map((r: any) => r._id);

    if (filteredIds.length === 0) {
      return [];
    }

    const chunkMap = await ctx.runQuery(internal.vectorSearch.getChunksByIds, {
      ids: filteredIds,
    });

    return results
      .filter((r: any) => r._score >= minScore && chunkMap[r._id])
      .map((r: any) => ({
        ...chunkMap[r._id],
        score: r._score,
      }));
  },
});

// Search memories by vector similarity
export const searchMemories = action({
  args: {
    userId: v.string(),
    embedding: v.array(v.float64()),
    limit: v.optional(v.number()),
    minScore: v.optional(v.number()),
    isCore: v.optional(v.boolean()),
    // Container tag for scoped search
    containerTag: v.optional(v.string()),
    // Metadata filters for advanced search
    metadataFilters: v.optional(
      v.object({
        category: v.optional(v.string()),
        type: v.optional(v.string()),
        isStatic: v.optional(v.boolean()),
      })
    ),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 10;
    const minScore = args.minScore ?? 0.5;

    // When containerTag is provided, fetch more to filter by container
    const fetchMultiplier = args.containerTag ? 5 : 2;

    // Convex vector search only supports single eq or or() filters
    // Filter by user_id here, then filter is_latest/is_core/containerTag in post-processing
    const results = await ctx.vectorSearch("memories", "by_embedding", {
      vector: args.embedding,
      limit: Math.min(limit * fetchMultiplier, 256), // More when filtering by container
      filter: (q) => q.eq("user_id", args.userId),
    });

    const filteredIds = results
      .filter((r: any) => r._score >= minScore)
      .map((r: any) => r._id);

    if (filteredIds.length === 0) {
      return [];
    }

    const memoryMap = await ctx.runQuery(
      internal.vectorSearch.getMemoriesByIds,
      { ids: filteredIds }
    );

    let filteredResults = results
      .filter(
        (r: any) =>
          r._score >= minScore &&
          memoryMap[r._id] &&
          memoryMap[r._id].is_latest !== false &&  // Filter for latest versions (true or undefined passes)
          !memoryMap[r._id].is_forgotten  // Filter out forgotten memories
      )
      .map((r: any) => {
        const mem = memoryMap[r._id];
        let score = r._score;

        // Apply recency boost for consistent ranking
        const updatedAt = mem.updated_at || mem.created_at || 0;
        if (updatedAt > 0) {
          const now = Date.now();
          const ageInDays = Math.min(365, (now - updatedAt) / (1000 * 60 * 60 * 24));
          // 50% recency boost: newer memories rank higher
          const recencyBoost = 1.0 + (0.50 * (1 - ageInDays / 365));
          score = Math.min(1.0, score * recencyBoost);
        }
        // Boost for confirmed latest versions
        if (mem.is_latest === true) {
          score = Math.min(1.0, score * 1.3);
        }

        return {
          ...mem,
          score,
          // Ensure is_latest is explicitly set for downstream processing
          is_latest: mem.is_latest ?? true,  // Default to true if undefined
        };
      });

    // Apply containerTag filter if provided (filter at Convex level for efficiency)
    if (args.containerTag) {
      filteredResults = filteredResults.filter((m: any) => {
        const tags = m.container_tags || [];
        return tags.includes(args.containerTag);
      });
    }

    // Apply metadata filters if provided
    if (args.metadataFilters) {
      const filters = args.metadataFilters;
      filteredResults = filteredResults.filter((m: any) => {
        if (filters.category && m.category !== filters.category) return false;
        if (filters.type && m.type !== filters.type) return false;
        if (filters.isStatic !== undefined && m.is_static !== filters.isStatic) return false;
        return true;
      });
    }

    return filteredResults.slice(0, limit);
  },
});

// Combined search across all data types
export const searchAll = action({
  args: {
    userId: v.string(),
    embedding: v.array(v.float64()),
    limit: v.optional(v.number()),
    minScore: v.optional(v.number()),
    searchDocuments: v.optional(v.boolean()),
    searchChunks: v.optional(v.boolean()),
    searchMemories: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 10;
    const minScore = args.minScore ?? 0.5;
    const includeDocs = args.searchDocuments !== false;
    const includeChunks = args.searchChunks !== false;
    const includeMemories = args.searchMemories !== false;

    // Run all searches in parallel
    const [docResults, chunkResults, memoryResults] = await Promise.all([
      includeDocs
        ? ctx
            .vectorSearch("documents", "by_embedding", {
              vector: args.embedding,
              limit,
              filter: (q) => q.eq("user_id", args.userId),
            })
            .catch(() => [])
        : Promise.resolve([]),
      includeChunks
        ? ctx
            .vectorSearch("document_chunks", "by_embedding", {
              vector: args.embedding,
              limit,
              filter: (q) => q.eq("user_id", args.userId),
            })
            .catch(() => [])
        : Promise.resolve([]),
      includeMemories
        ? ctx
            .vectorSearch("memories", "by_embedding", {
              vector: args.embedding,
              limit: Math.min(limit * 2, 256),  // Get extra for post-filter, cap at Convex max
              filter: (q) => q.eq("user_id", args.userId),
            })
            .catch(() => [])
        : Promise.resolve([]),
    ]);

    // Collect IDs for batch fetching
    const docIds = docResults
      .filter((r: any) => r._score >= minScore)
      .map((r: any) => r._id);
    const chunkIds = chunkResults
      .filter((r: any) => r._score >= minScore)
      .map((r: any) => r._id);
    const memoryIds = memoryResults
      .filter((r: any) => r._score >= minScore)
      .map((r: any) => r._id);

    // Batch fetch all data
    const [docMap, chunkMap, memoryMap] = await Promise.all([
      docIds.length > 0
        ? ctx.runQuery(internal.vectorSearch.getDocumentsByIds, { ids: docIds })
        : Promise.resolve({}),
      chunkIds.length > 0
        ? ctx.runQuery(internal.vectorSearch.getChunksByIds, { ids: chunkIds })
        : Promise.resolve({}),
      memoryIds.length > 0
        ? ctx.runQuery(internal.vectorSearch.getMemoriesByIds, {
            ids: memoryIds,
          })
        : Promise.resolve({}),
    ]);

    // Build combined results
    const results: any[] = [];

    for (const r of docResults) {
      if (r._score >= minScore && docMap[r._id]) {
        results.push({
          type: "document",
          ...docMap[r._id],
          score: r._score,
        });
      }
    }

    for (const r of chunkResults) {
      if (r._score >= minScore && chunkMap[r._id]) {
        results.push({
          type: "chunk",
          ...chunkMap[r._id],
          score: r._score,
        });
      }
    }

    for (const r of memoryResults) {
      const mem = memoryMap[r._id];
      if (
        r._score >= minScore &&
        mem &&
        mem.is_latest !== false &&
        !mem.is_forgotten
      ) {
        // Apply recency boost to score for consistent ranking with recall-service
        let score = r._score;
        const updatedAt = mem.updated_at || mem.created_at || 0;
        if (updatedAt > 0) {
          const now = Date.now();
          const ageInDays = Math.min(365, (now - updatedAt) / (1000 * 60 * 60 * 24));
          // 50% recency boost: newer memories rank higher
          const recencyBoost = 1.0 + (0.50 * (1 - ageInDays / 365));
          score = Math.min(1.0, score * recencyBoost);
        }
        // Boost for confirmed latest versions
        if (mem.is_latest === true) {
          score = Math.min(1.0, score * 1.3);
        }

        results.push({
          type: "memory",
          ...mem,
          score,
          is_latest: mem.is_latest ?? true,  // Default to true if undefined
        });
      }
    }

    // Sort by score and limit
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  },
});
