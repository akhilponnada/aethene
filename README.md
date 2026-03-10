<div align="center">

# Aethene

**Open source memory infrastructure for AI agents**

Store content, extract atomic memories, search semantically, and recall the right context when your agent needs it.

[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Hono](https://img.shields.io/badge/Hono-E36002?style=for-the-badge)](https://hono.dev/)
[![Convex](https://img.shields.io/badge/Convex-FF6B6B?style=for-the-badge)](https://convex.dev/)
[![MIT License](https://img.shields.io/badge/License-MIT-22C55E?style=for-the-badge)](./LICENSE)

[Quick Start](#quick-start) · [API](#api-surface) · [Architecture](#architecture) · [Self-Hosting](#self-hosting) · [Contributing](#contributing)

</div>

---

## Why Aethene

Aethene is built for teams that want memory as infrastructure, not as a black box SaaS dependency.

| Built for agents | Retrieval that understands context | Safe multi-tenant isolation |
| --- | --- | --- |
| Ingest conversations, notes, documents, and URLs. | Hybrid search combines vector similarity with reranking and recall logic. | `containerTag` scoping keeps memory separated per user, workspace, or tenant. |

| Memory that evolves | Developer-friendly API | Fully self-hostable |
| --- | --- | --- |
| Versioning and contradiction handling keep newer facts current without losing history. | Clean REST endpoints, OpenAPI spec, and migration-friendly compatibility routes. | Run it yourself with Node.js, Convex, and Docker. |

## Core Capabilities

- Automatic memory extraction from raw content
- EntityContext support for resolving `I`, `me`, and `my`
- Container-tag filtering for multi-tenant isolation
- Hybrid search and recall workflows
- Memory versioning and contradiction detection
- Entity graph and relationship extraction
- File and URL ingestion

## How It Works

```text
Raw content
  -> ingest
  -> chunk + extract memories
  -> embed + index
  -> search / recall / profile / relations
```

## Quick Start

### Prerequisites

- Node.js 18+
- A Convex deployment
- A Gemini API key for embeddings

### Setup

```bash
git clone https://github.com/Nuro-Labs/aethene.git
cd aethene
npm install
cp .env.example .env
```

Fill in the required values in `.env`:

| Variable | Required | Purpose |
| --- | --- | --- |
| `CONVEX_URL` | Yes | Convex deployment URL |
| `GEMINI_API_KEY` | Yes | Embeddings and memory extraction support |
| `OPENAI_API_KEY` | No | Optional OpenAI-backed extraction path |
| `EXTRACTION_MODEL` | No | Extraction model override |
| `API_KEYS` | No | Comma-separated dev API keys |
| `SETTINGS_ENCRYPTION_KEY` | No | Required if you want to persist connector secrets securely |
| `PORT` | No | API server port, default `3006` |

### Run

```bash
npm run server
```

The API will start on `http://localhost:3006`.

## Example Flow

### 1. Ingest a document

```bash
curl -X POST http://localhost:3006/v3/documents \
  -H "X-API-Key: your-key" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "Sarah works at Google as a software engineer and has a dog named Luna.",
    "containerTag": "user_123"
  }'
```

### 2. Search what the system remembered

```bash
curl -X POST http://localhost:3006/v1/search \
  -H "X-API-Key: your-key" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "What pet does Sarah have?",
    "containerTag": "user_123",
    "mode": "memories",
    "limit": 5
  }'
```

### 3. Typical extracted memories

```text
- Sarah works at Google
- Sarah is a software engineer
- Sarah has a dog named Luna
- Luna is Sarah's dog
```

## API Surface

The full spec lives in [`openapi.yaml`](./openapi.yaml).

### Core endpoints

| Area | Endpoint | Description |
| --- | --- | --- |
| Health | `GET /health` | Basic health check |
| Documents | `POST /v3/documents` | Ingest text or URL content |
| Documents | `POST /v3/documents/file` | Upload and process a file |
| Search | `POST /v1/search` | Semantic search over memories/documents |
| Recall | `POST /v1/recall` | Context assembly for agent use |
| Memories | `GET /v1/memories` | List stored memories |
| Memories | `PATCH /v1/memories/:id` | Update a memory |
| Profile | `GET /v1/profile` | Build a profile from static and dynamic memories |
| Relations | `GET /v1/relations` | Inspect relationships and graph data |
| Settings | `GET/PATCH /v1/settings` | User and container settings |
| Auth | `POST /v1/auth/keys` | Create scoped API keys |

### Request shape

```json
{
  "content": "Your source content",
  "containerTag": "user_123",
  "entityContext": "Alice is the user speaking in first person"
}
```

### Search shape

```json
{
  "query": "Where does Sarah work?",
  "containerTag": "user_123",
  "limit": 10,
  "mode": "memories"
}
```

## Architecture

```text
Clients
  -> Hono API routes
  -> auth + rate limiting
  -> ingest / extraction / recall services
  -> Convex for data, indexing, and vectors
  -> Gemini / LLM providers for embeddings and extraction
```

### Important files

| File | Role |
| --- | --- |
| `src/services/memory-extractor.ts` | Core memory extraction logic |
| `src/services/recall-service.ts` | Search, filtering, reranking, and recall |
| `convex/vectorSearch.ts` | Vector search and container-tag filtering |
| `src/routes/search.ts` | Search API endpoints |
| `src/routes/documents.ts` | Document ingestion and file upload |

## Self-Hosting

### Docker

```bash
docker-compose up -d
```

### Manual

```bash
npx convex dev
npm install
cp .env.example .env
npm run server
```

## Development

```bash
npm run typecheck
npm run test:run
npm run test:integration
npm run build
```

### Useful scripts

| Command | Purpose |
| --- | --- |
| `npm run server` | Start the API locally |
| `npm run server:dev` | Start with file watching |
| `npm run typecheck` | Run TypeScript checks |
| `npm run test:run` | Run the test suite |
| `npm run test:integration` | Run integration tests |
| `npm run test:load` | Run load testing script |
| `npm run build` | Build `dist/` |
| `npm run audit` | Dependency audit |

## Use Cases

- Long-lived assistant memory
- Agent copilots with user-specific context
- Semantic profile building
- Cross-session recall for chat products
- Memory-backed search across ingested content
- Multi-tenant AI applications

## Contributing

Issues and pull requests are welcome. If you are contributing core behavior, the best places to start are the ingest, extraction, recall, and vector-search layers listed above.

## License

MIT. See [LICENSE](./LICENSE).

---

<div align="center">

**Aethene is open source memory infrastructure for AI.**

[GitHub](https://github.com/Nuro-Labs/aethene) · [Issues](https://github.com/Nuro-Labs/aethene/issues)

Made with love in Edinburgh.

</div>
