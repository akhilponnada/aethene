import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

/**
 * Content (Documents) - CRUD operations
 */

// Create a new document
export const create = mutation({
  args: {
    userId: v.string(),
    content: v.string(),
    customId: v.optional(v.string()),
    contentType: v.optional(v.string()),
    title: v.optional(v.string()),
    summary: v.optional(v.string()),
    containerTags: v.optional(v.array(v.string())),  // Supermemory compatible
    metadata: v.optional(v.any()),
    embedding: v.optional(v.array(v.float64())),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Check for existing document with same custom_id
    if (args.customId) {
      const existing = await ctx.db
        .query("documents")
        .withIndex("by_user_custom_id", (q) =>
          q.eq("user_id", args.userId).eq("custom_id", args.customId)
        )
        .first();

      if (existing) {
        // Update existing document
        await ctx.db.patch(existing._id, {
          content: args.content,
          content_type: args.contentType,
          title: args.title,
          summary: args.summary,
          container_tags: args.containerTags,
          metadata: args.metadata,
          embedding: args.embedding,
          status: "completed",
          updated_at: now,
        });
        return existing._id;
      }
    }

    // Create new document
    const id = await ctx.db.insert("documents", {
      user_id: args.userId,
      custom_id: args.customId,
      content: args.content,
      content_type: args.contentType ?? "text",
      title: args.title,
      summary: args.summary,
      container_tags: args.containerTags,
      status: "completed",
      metadata: args.metadata,
      embedding: args.embedding,
      created_at: now,
      updated_at: now,
    });

    return id;
  },
});

// Get document by ID
export const get = query({
  args: { id: v.id("documents") },
  handler: async (ctx, args) => {
    return ctx.db.get(args.id);
  },
});

// Get document by custom ID
export const getByCustomId = query({
  args: { userId: v.string(), customId: v.string() },
  handler: async (ctx, args) => {
    return ctx.db
      .query("documents")
      .withIndex("by_user_custom_id", (q) =>
        q.eq("user_id", args.userId).eq("custom_id", args.customId)
      )
      .first();
  },
});

// List documents for user
export const list = query({
  args: {
    userId: v.string(),
    limit: v.optional(v.number()),
    status: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;

    if (args.status) {
      return ctx.db
        .query("documents")
        .withIndex("by_user_status", (q) =>
          q.eq("user_id", args.userId).eq("status", args.status!)
        )
        .order("desc")
        .take(limit);
    }

    return ctx.db
      .query("documents")
      .withIndex("by_user", (q) => q.eq("user_id", args.userId))
      .order("desc")
      .take(limit);
  },
});

// Update document status
export const updateStatus = mutation({
  args: {
    id: v.id("documents"),
    status: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      status: args.status,
      updated_at: Date.now(),
    });
    return { success: true };
  },
});

// Update document
export const update = mutation({
  args: {
    id: v.id("documents"),
    content: v.optional(v.string()),
    title: v.optional(v.string()),
    metadata: v.optional(v.any()),
    embedding: v.optional(v.array(v.float64())),
  },
  handler: async (ctx, args) => {
    const updates: Record<string, any> = { updated_at: Date.now() };

    if (args.content !== undefined) updates.content = args.content;
    if (args.title !== undefined) updates.title = args.title;
    if (args.metadata !== undefined) updates.metadata = args.metadata;
    if (args.embedding !== undefined) updates.embedding = args.embedding;

    await ctx.db.patch(args.id, updates);
    return { success: true };
  },
});

// Delete document
export const remove = mutation({
  args: { id: v.id("documents") },
  handler: async (ctx, args) => {
    // Also delete associated chunks
    const doc = await ctx.db.get(args.id);
    if (doc) {
      const chunks = await ctx.db
        .query("document_chunks")
        .withIndex("by_document", (q) => q.eq("document_id", args.id))
        .collect();

      await Promise.all(chunks.map((chunk) => ctx.db.delete(chunk._id)));
    }

    await ctx.db.delete(args.id);
    return { success: true };
  },
});

// Delete by custom ID
export const removeByCustomId = mutation({
  args: { userId: v.string(), customId: v.string() },
  handler: async (ctx, args) => {
    const doc = await ctx.db
      .query("documents")
      .withIndex("by_user_custom_id", (q) =>
        q.eq("user_id", args.userId).eq("custom_id", args.customId)
      )
      .first();

    if (!doc) {
      return { success: false, error: "Document not found" };
    }

    // Delete associated chunks
    const chunks = await ctx.db
      .query("document_chunks")
      .withIndex("by_document", (q) => q.eq("document_id", doc._id))
      .collect();

    await Promise.all(chunks.map((chunk) => ctx.db.delete(chunk._id)));

    await ctx.db.delete(doc._id);
    return { success: true };
  },
});

// Count documents for user
export const count = query({
  args: {
    userId: v.string(),
    status: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    let documents;

    if (args.status) {
      documents = await ctx.db
        .query("documents")
        .withIndex("by_user_status", (q) =>
          q.eq("user_id", args.userId).eq("status", args.status!)
        )
        .collect();
    } else {
      documents = await ctx.db
        .query("documents")
        .withIndex("by_user", (q) => q.eq("user_id", args.userId))
        .collect();
    }

    return { count: documents.length };
  },
});

// Bulk delete documents
export const bulkDelete = mutation({
  args: {
    userId: v.string(),
    ids: v.array(v.id("documents")),
  },
  handler: async (ctx, args) => {
    // Rate limit
    if (args.ids.length > 50) {
      throw new Error("Maximum 50 documents per bulk delete");
    }

    const deleted: string[] = [];
    const errors: Array<{ id: string; error: string }> = [];

    for (const id of args.ids) {
      try {
        const doc = await ctx.db.get(id);

        if (!doc) {
          errors.push({ id, error: "Document not found" });
          continue;
        }

        if (doc.user_id !== args.userId) {
          errors.push({ id, error: "Access denied" });
          continue;
        }

        // Delete associated chunks
        const chunks = await ctx.db
          .query("document_chunks")
          .withIndex("by_document", (q) => q.eq("document_id", id))
          .collect();

        await Promise.all(chunks.map((chunk) => ctx.db.delete(chunk._id)));

        // Delete document
        await ctx.db.delete(id);
        deleted.push(id);
      } catch (e: any) {
        errors.push({ id, error: e.message });
      }
    }

    return { deleted, errors };
  },
});
