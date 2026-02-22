import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Aethene Convex Schema
 * Simplified memory API with 4 core tables
 */
export default defineSchema({
  // ============================================================================
  // DOCUMENTS - Content storage
  // ============================================================================
  documents: defineTable({
    user_id: v.string(),
    custom_id: v.optional(v.string()),  // User-provided ID for deduplication
    content: v.string(),
    content_type: v.optional(v.string()),  // 'text', 'url', 'file', etc.
    title: v.optional(v.string()),
    summary: v.optional(v.string()),  // AI-generated summary of the document
    status: v.string(),  // 'pending', 'processing', 'completed', 'failed'
    container_tags: v.optional(v.array(v.string())),  // Container tags for scoping (Supermemory compatible)
    metadata: v.optional(v.any()),
    embedding: v.optional(v.array(v.float64())),
    created_at: v.float64(),
    updated_at: v.float64(),
  })
    .index("by_user", ["user_id"])
    .index("by_user_custom_id", ["user_id", "custom_id"])
    .index("by_user_status", ["user_id", "status"])
    .index("by_user_container", ["user_id", "container_tags"])
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 768,  // Gemini embedding dimensions
      filterFields: ["user_id", "content_type"],
    }),

  // ============================================================================
  // DOCUMENT CHUNKS - For RAG search
  // ============================================================================
  document_chunks: defineTable({
    user_id: v.string(),
    document_id: v.string(),  // Reference to documents table (external ID or _id)
    content: v.string(),
    chunk_index: v.float64(),
    container_tags: v.optional(v.array(v.string())),  // Inherited from parent document for filtering
    embedding: v.optional(v.array(v.float64())),
    created_at: v.float64(),
  })
    .index("by_user", ["user_id"])
    .index("by_document", ["document_id"])
    .index("by_user_document", ["user_id", "document_id"])
    .index("by_user_container", ["user_id", "container_tags"])
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 768,
      filterFields: ["user_id", "document_id"],
    }),

  // ============================================================================
  // MEMORIES - Core memory storage with versioning
  // ============================================================================
  memories: defineTable({
    user_id: v.string(),
    content: v.string(),
    is_core: v.boolean(),  // true = permanent core memory, false = recent memory
    is_latest: v.boolean(),  // true = current version, false = superseded
    is_forgotten: v.boolean(),  // Soft delete for GDPR compliance
    version: v.float64(),  // Version number for tracking changes
    previous_version: v.optional(v.string()),  // ID of previous version
    source_document: v.optional(v.string()),  // Document this memory came from
    container_tags: v.optional(v.array(v.string())),  // Inherited from source document for filtering
    metadata: v.optional(v.any()),
    embedding: v.optional(v.array(v.float64())),
    created_at: v.float64(),
    updated_at: v.float64(),
    // New fields for memory relationships
    memory_kind: v.optional(v.string()),  // "fact" | "preference" | "event"
    forgotten: v.optional(v.boolean()),  // Alias for soft delete (for API compatibility)
    expires_at: v.optional(v.float64()),  // For time-based decay / auto-forget
  })
    .index("by_user", ["user_id"])
    .index("by_user_core", ["user_id", "is_core"])
    .index("by_user_latest", ["user_id", "is_latest"])
    .index("by_user_forgotten", ["user_id", "is_forgotten"])
    .index("by_previous_version", ["previous_version"])
    .index("by_user_expires", ["user_id", "expires_at"])
    .index("by_user_kind", ["user_id", "memory_kind"])
    .index("by_user_container", ["user_id", "container_tags"])
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 768,
      filterFields: ["user_id", "is_core", "is_latest"],
    }),

  // ============================================================================
  // MEMORY LINKS - Relationships between memories
  // ============================================================================
  memory_links: defineTable({
    from_memory: v.id("memories"),
    to_memory: v.id("memories"),
    link_type: v.string(),  // "supersedes" | "enriches" | "inferred" | "relates_to"
    confidence: v.float64(),
    created_at: v.float64(),
  })
    .index("by_from", ["from_memory"])
    .index("by_to", ["to_memory"])
    .index("by_type", ["link_type"]),

  // ============================================================================
  // ENTITIES - Graph Memory nodes (people, orgs, locations, etc.)
  // ============================================================================
  entities: defineTable({
    user_id: v.string(),
    name: v.string(),  // Entity name (e.g., "John Smith", "Google", "San Francisco")
    normalized_name: v.string(),  // Lowercase for matching
    entity_type: v.string(),  // "person" | "organization" | "location" | "date" | "concept" | "other"
    attributes: v.optional(v.any()),  // Additional attributes about the entity
    mention_count: v.float64(),  // How often this entity appears
    container_tags: v.optional(v.array(v.string())),
    created_at: v.float64(),
    updated_at: v.float64(),
  })
    .index("by_user", ["user_id"])
    .index("by_user_name", ["user_id", "normalized_name"])
    .index("by_user_type", ["user_id", "entity_type"])
    .index("by_user_container", ["user_id", "container_tags"]),

  // ============================================================================
  // ENTITY LINKS - Relationships between entities (semantic graph)
  // ============================================================================
  entity_links: defineTable({
    user_id: v.string(),
    from_entity: v.id("entities"),
    to_entity: v.id("entities"),
    relationship: v.string(),  // "works_at" | "lives_in" | "married_to" | "friend_of" | "owns" | "related_to"
    confidence: v.float64(),
    source_memory: v.optional(v.id("memories")),  // Memory this was derived from
    created_at: v.float64(),
  })
    .index("by_from", ["from_entity"])
    .index("by_to", ["to_entity"])
    .index("by_user", ["user_id"])
    .index("by_relationship", ["relationship"]),

  // ============================================================================
  // MEMORY ENTITIES - Junction table linking memories to entities
  // ============================================================================
  memory_entities: defineTable({
    memory_id: v.id("memories"),
    entity_id: v.id("entities"),
    role: v.string(),  // "subject" | "object" | "mentioned"
    created_at: v.float64(),
  })
    .index("by_memory", ["memory_id"])
    .index("by_entity", ["entity_id"]),

  // ============================================================================
  // API KEYS - Authentication
  // ============================================================================
  api_keys: defineTable({
    key: v.string(),
    user_id: v.string(),
    name: v.optional(v.string()),
    rate_limit: v.optional(v.float64()),  // Requests per hour
    monthly_limit: v.optional(v.float64()),  // Requests per month
    requests_this_month: v.optional(v.float64()),
    is_active: v.boolean(),
    last_used_at: v.optional(v.float64()),
    expires_at: v.optional(v.float64()),
    created_at: v.float64(),
    // Scoped API key fields (Supermemory v3 compatible)
    is_scoped: v.optional(v.boolean()),  // true = scoped key, false/undefined = full access
    container_tags: v.optional(v.array(v.string())),  // Restrict access to specific containers
    permissions: v.optional(v.array(v.string())),  // "read", "write", "delete", "admin"
    parent_key_id: v.optional(v.string()),  // Reference to parent API key (for scoped keys)
    description: v.optional(v.string()),  // User-provided description
  })
    .index("by_key", ["key"])
    .index("by_user", ["user_id"])
    .index("by_parent", ["parent_key_id"]),

  // ============================================================================
  // SETTINGS - User/container configuration (Supermemory v3 compatible)
  // ============================================================================
  settings: defineTable({
    user_id: v.string(),
    container_tag: v.optional(v.string()),  // Optional scoping per container
    // LLM filtering settings
    should_llm_filter: v.optional(v.boolean()),  // Enable/disable LLM filtering
    filter_prompt: v.optional(v.string()),  // Custom prompt for LLM filtering
    // Chunking settings
    chunk_size: v.optional(v.float64()),  // Default chunk size for document processing
    chunk_overlap: v.optional(v.float64()),  // Overlap between chunks
    // Entity context settings (per containerTag)
    entity_context: v.optional(v.any()),  // Custom context per entity type
    // Connector branding (Supermemory feature)
    connector_branding: v.optional(v.any()),  // Custom branding for connectors
    // Google Drive connector settings
    google_drive_custom_key_enabled: v.optional(v.boolean()),
    google_drive_client_id: v.optional(v.string()),
    google_drive_client_secret: v.optional(v.string()),
    // Notion connector settings
    notion_custom_key_enabled: v.optional(v.boolean()),
    notion_client_id: v.optional(v.string()),
    notion_client_secret: v.optional(v.string()),
    // OneDrive connector settings
    onedrive_custom_key_enabled: v.optional(v.boolean()),
    onedrive_client_id: v.optional(v.string()),
    onedrive_client_secret: v.optional(v.string()),
    // Timestamps
    created_at: v.float64(),
    updated_at: v.float64(),
  })
    .index("by_user", ["user_id"])
    .index("by_user_container", ["user_id", "container_tag"]),
});
