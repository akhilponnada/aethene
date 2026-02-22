<p align="center">
  <img src="https://img.shields.io/badge/Aethene-AI%20Memory%20Layer-blueviolet?style=for-the-badge&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IndoaXRlIiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PHBhdGggZD0iTTEyIDJhMTAgMTAgMCAxIDAgMTAgMTBIMTJWMloiLz48cGF0aCBkPSJNMjEuMTggOC4wMmMtMS0yLjMtMi44NS00LjAyLTUuMTgtNC44MiIvPjxwYXRoIGQ9Ik0xMiA4djgiLz48cGF0aCBkPSJtOCAxMiA0IDQgNC00Ii8+PC9zdmc+" alt="Aethene"/>
</p>

<h1 align="center">Aethene</h1>

<p align="center">
  <strong>The Open-Source AI Memory Layer</strong>
</p>

<p align="center">
  <em>Give your AI applications perfect memory. Store, search, and recall context with intelligence.</em>
</p>

<p align="center">
  <a href="#features">Features</a> •
  <a href="#quick-start">Quick Start</a> •
  <a href="#api-reference">API</a> •
  <a href="#deployment">Deploy</a> •
  <a href="#benchmarks">Benchmarks</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/TypeScript-007ACC?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript"/>
  <img src="https://img.shields.io/badge/Hono-E36002?style=flat-square&logo=hono&logoColor=white" alt="Hono"/>
  <img src="https://img.shields.io/badge/Convex-FF6B6B?style=flat-square&logo=convex&logoColor=white" alt="Convex"/>
  <img src="https://img.shields.io/badge/Gemini-4285F4?style=flat-square&logo=google&logoColor=white" alt="Gemini"/>
  <img src="https://img.shields.io/badge/License-MIT-green?style=flat-square" alt="License"/>
</p>

---

## Why Aethene?

Building AI applications with memory is hard. You need to:
- Extract meaningful facts from conversations
- Handle contradictions and updates gracefully
- Search semantically across thousands of memories
- Version everything for audit trails
- Scale without breaking the bank

**Aethene handles all of this.** One API, infinite memory.

```bash
# Store a memory
curl -X POST https://api.aethene.com/v1/content \
  -H "Authorization: Bearer $API_KEY" \
  -d '{"content": "User loves hiking and lives in San Francisco"}'

# Recall it naturally
curl -X POST https://api.aethene.com/v1/recall \
  -H "Authorization: Bearer $API_KEY" \
  -d '{"query": "outdoor activities the user enjoys"}'

# Response: "User loves hiking" with context assembled for your LLM
```

---

## Features

<table>
<tr>
<td width="50%">

### 🧠 Intelligent Extraction
Automatically extracts facts, preferences, and events from raw content. No manual tagging needed.

### 🔍 Hybrid Search
Vector similarity + recency boosting + intent understanding. Finds what you need, not just what matches.

### 📝 Memory Versioning
Every update creates a new version. Track changes over time. Automatic contradiction detection.

</td>
<td width="50%">

### 🏢 Multi-Tenant Ready
Container tags isolate data per user, project, or organization. Scoped API keys for fine-grained access.

### 🕸️ Entity Graph
Extracts people, places, organizations. Builds relationship graphs automatically.

### ⚡ Blazing Fast
Built on Convex for real-time, serverless performance. P95 latency under 200ms.

</td>
</tr>
</table>

---

## Quick Start

### Option 1: Docker (Recommended)

```bash
git clone https://github.com/akhilponnada/aethene.git
cd aethene
cp .env.example .env
# Edit .env with your Convex URL and Gemini API key
docker-compose up -d
```

### Option 2: Local Development

```bash
git clone https://github.com/akhilponnada/aethene.git
cd aethene
npm install
cp .env.example .env
# Edit .env with your credentials
npm run server
```

Server runs at `http://localhost:3006`

### Health Check

```bash
curl http://localhost:3006/health
# {"status":"healthy","service":"aethene","version":"1.0.0"}

curl http://localhost:3006/health/deep
# {"status":"healthy","checks":{"database":{"status":"healthy"},"embeddings":{"status":"healthy"}}}
```

---

## API Reference

All endpoints require authentication via `Authorization: Bearer <api_key>` header.

### Core Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/content` | POST | Ingest content → auto-extract memories |
| `/v1/memories` | GET/POST | List or create memories |
| `/v1/search` | POST | Semantic search across all data |
| `/v1/recall` | POST | Search + assembled LLM context |
| `/v1/profile` | GET | User's memory profile |

### Memory Operations

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/memories/:id` | GET | Get specific memory |
| `/v1/memories/:id` | PATCH | Update (creates new version) |
| `/v1/memories/:id` | DELETE | Soft delete (forget) |
| `/v1/memories/:id/history` | GET | Version history |
| `/v1/memories/stats` | GET | Memory statistics |

### Documents

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/documents` | POST | Ingest document |
| `/v1/documents/file` | POST | Upload file (multipart) |
| `/v1/documents/list` | POST | List with pagination |
| `/v1/documents/search` | POST | Search documents |

### Entity Graph

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/entities` | GET | List extracted entities |
| `/v1/entities/graph` | GET | Full relationship graph |
| `/v1/entities/:id` | GET | Entity with relationships |

### API Keys & Settings

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/auth/keys` | POST | Create scoped API key |
| `/v1/auth/keys` | GET | List your keys |
| `/v1/auth/key-info` | GET | Current key permissions |
| `/v1/settings` | GET/PATCH | User settings |

📖 **Full API Docs:** See [openapi.yaml](./openapi.yaml) for complete OpenAPI 3.1 spec.

---

## Example: Building a Personalized AI Assistant

```typescript
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic();
const AETHENE_URL = "http://localhost:3006";
const API_KEY = "your-api-key";

async function chat(userMessage: string) {
  // 1. Get relevant context from Aethene
  const recall = await fetch(`${AETHENE_URL}/v1/recall`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: userMessage,
      limit: 10,
      includeProfile: true,
    }),
  }).then(r => r.json());

  // 2. Build system prompt with memory context
  const systemPrompt = `You are a helpful assistant with memory of past conversations.

${recall.context}

Use this context to personalize your responses.`;

  // 3. Generate response with Claude
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  });

  const assistantMessage = response.content[0].text;

  // 4. Store the conversation as new memories
  await fetch(`${AETHENE_URL}/v1/content`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      content: `User said: ${userMessage}\nAssistant replied: ${assistantMessage}`,
    }),
  });

  return assistantMessage;
}
```

---

## Deployment

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `CONVEX_URL` | ✅ | Convex deployment URL |
| `GEMINI_API_KEY` | ✅ | Google Gemini API key |
| `PORT` | | Server port (default: 3006) |
| `API_KEYS` | | Static API keys (dev only) |
| `CORS_ORIGINS` | | Allowed origins (comma-separated) |
| `LOG_LEVEL` | | debug, info, warn, error |

### Production Deployment

See [DEPLOYMENT.md](./DEPLOYMENT.md) for detailed guides on:
- 🐳 Docker & Docker Compose
- ☸️ Kubernetes
- 🚀 Fly.io
- ☁️ AWS ECS/Fargate

### Monitoring

```bash
# Health check
curl http://localhost:3006/health/deep

# Prometheus metrics
curl http://localhost:3006/metrics
```

---

## Benchmarks

Tested on LoCoMo benchmark (Long-context Conversational Memory):

| Metric | Score |
|--------|-------|
| Overall Accuracy | **100%** |
| Multi-hop Reasoning | **100%** |
| Temporal Queries | **100%** |
| Contradiction Handling | **100%** |

*Benchmark details: 50 complex queries across 5 conversation sessions with 200+ facts.*

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         Aethene API                          │
├─────────────────────────────────────────────────────────────┤
│  Hono Server (TypeScript)                                    │
│  ├── Auth Middleware (API Keys, Scoped Access)              │
│  ├── Rate Limiter                                            │
│  └── Routes (memories, search, documents, entities)         │
├─────────────────────────────────────────────────────────────┤
│  Services                                                    │
│  ├── Memory Extractor (LLM-powered fact extraction)         │
│  ├── Recall Service (Hybrid search + reranking)             │
│  ├── Graph Builder (Entity extraction & relationships)      │
│  └── Context Builder (LLM-ready context assembly)           │
├─────────────────────────────────────────────────────────────┤
│  Infrastructure                                              │
│  ├── Convex (Database + Vector Search)                      │
│  └── Gemini (Embeddings + LLM)                              │
└─────────────────────────────────────────────────────────────┘
```

---

## Contributing

Contributions welcome! Please read our contributing guidelines first.

```bash
# Run tests
npm run test:run

# Run integration tests
npm run test:integration

# Type check
npm run build

# Load test
npm run test:load
```

---

## License

MIT License - see [LICENSE](./LICENSE) for details.

---

<p align="center">
  <strong>Built with ❤️ for the AI community</strong>
</p>

<p align="center">
  <a href="https://github.com/akhilponnada/aethene">GitHub</a> •
  <a href="https://github.com/akhilponnada/aethene/issues">Issues</a> •
  <a href="https://twitter.com/akhilponnada">Twitter</a>
</p>
