import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

/**
 * Document Chunks - For RAG search
 */

// Create a single chunk
export const create = mutation({
  args: {
    userId: v.string(),
    documentId: v.string(),
    content: v.string(),
    chunkIndex: v.number(),
    embedding: v.optional(v.array(v.float64())),
    containerTags: v.optional(v.array(v.string())),  // Inherited from source document
  },
  handler: async (ctx, args) => {
    return ctx.db.insert("document_chunks", {
      user_id: args.userId,
      document_id: args.documentId,
      content: args.content,
      chunk_index: args.chunkIndex,
      embedding: args.embedding,
      container_tags: args.containerTags,  // Store container tags for filtering
      created_at: Date.now(),
    });
  },
});

// Batch create chunks (more efficient)
export const batchCreate = mutation({
  args: {
    chunks: v.array(
      v.object({
        userId: v.string(),
        documentId: v.string(),
        content: v.string(),
        chunkIndex: v.number(),
        embedding: v.optional(v.array(v.float64())),
        containerTags: v.optional(v.array(v.string())),  // Inherited from source document
      })
    ),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    const ids = await Promise.all(
      args.chunks.map((chunk) =>
        ctx.db.insert("document_chunks", {
          user_id: chunk.userId,
          document_id: chunk.documentId,
          content: chunk.content,
          chunk_index: chunk.chunkIndex,
          embedding: chunk.embedding,
          container_tags: chunk.containerTags,  // Store container tags for filtering
          created_at: now,
        })
      )
    );

    return ids;
  },
});

// Get chunks by document
export const getByDocument = query({
  args: { documentId: v.string() },
  handler: async (ctx, args) => {
    return ctx.db
      .query("document_chunks")
      .withIndex("by_document", (q) => q.eq("document_id", args.documentId))
      .order("asc")
      .collect();
  },
});

// Get chunks by user
export const getByUser = query({
  args: { userId: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    return ctx.db
      .query("document_chunks")
      .withIndex("by_user", (q) => q.eq("user_id", args.userId))
      .order("desc")
      .take(args.limit ?? 100);
  },
});

// Delete chunks by document
export const deleteByDocument = mutation({
  args: { documentId: v.string() },
  handler: async (ctx, args) => {
    const chunks = await ctx.db
      .query("document_chunks")
      .withIndex("by_document", (q) => q.eq("document_id", args.documentId))
      .collect();

    await Promise.all(chunks.map((chunk) => ctx.db.delete(chunk._id)));

    return { deleted: chunks.length };
  },
});

// Delete chunk by ID
export const remove = mutation({
  args: { id: v.id("document_chunks") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
    return { success: true };
  },
});
