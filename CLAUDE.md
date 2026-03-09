# Claude Code Instructions

## Git Commits

When making commits, always use the following co-author:

```
Co-Authored-By: Naga Sri Arvapalli <nagasri3007@gmail.com>
```

## Project: Aethene

Aethene is an AI memory infrastructure - an open-source alternative for AI memory management.

### Key Features
- Intelligent memory extraction from content
- EntityContext for resolving "I/me/my" to actual names
- ContainerTag filtering for multi-tenant isolation
- Hybrid search with vector similarity + reranking
- Memory versioning and contradiction detection

### Important Files
- `src/services/memory-extractor.ts` - Core memory extraction logic
- `src/services/recall-service.ts` - Search and retrieval
- `convex/vectorSearch.ts` - Convex vector search with containerTag filtering
- `src/routes/search.ts` - Search API endpoints
