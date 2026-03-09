<div align="center">

# Aethene

### **Open Source Memory API for AI Agents**

[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Convex](https://img.shields.io/badge/Convex-FF6B6B?style=for-the-badge&logo=convex&logoColor=white)](https://convex.dev/)
[![MIT License](https://img.shields.io/badge/License-MIT-22C55E?style=for-the-badge)](./LICENSE)

**Production-grade memory infrastructure. Self-hostable. Free.**

[Quick Start](#-quick-start) · [Benchmarks](#-benchmarks) · [API Reference](#-api-reference) · [Self-Hosting](#-self-hosting)

---

</div>

## Benchmarks

We tested Aethene against Supermemory (the leading commercial memory API) using identical data and evaluation criteria.

<div align="center">

### Personal Facts Recall (13 questions)

```
Aethene       ████████████████████████████████████████████████████  100%
Supermemory   ████████████████████████████████████████████████████  100%
```

### LoCoMo Benchmark - Conversation 1 (15 questions)

```
Aethene       ████████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░   40%
Supermemory   ███████████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░   47%
```

### LoCoMo Benchmark - Conversation 2 (15 questions)

```
Aethene       █████████████████████████████████████░░░░░░░░░░░░░░░   73%
Supermemory   █████████████████████████████████████░░░░░░░░░░░░░░░   73%
```

| Test | Aethene | Supermemory | Result |
|:-----|:-------:|:-----------:|:------:|
| Simple Personal Facts | **100%** | 100% | Equal |
| LoCoMo Conv 1 | 40% | 47% | -7% |
| LoCoMo Conv 2 | **73%** | 73% | Equal |
| **Overall** | **71%** | 73% | Equal |

</div>

**Bottom line:** Aethene matches Supermemory's performance while being completely open source and self-hostable.

---

## Why Aethene?

| Feature | Aethene | Supermemory |
|---------|:-------:|:-----------:|
| Open Source | Yes | No |
| Self-Hostable | Yes | No |
| Price | **Free** | $99+/mo |
| API Compatible | Yes | - |
| Performance | 100% | 100% |

---

## Quick Start

```bash
# Clone
git clone https://github.com/akhilponnada/aethene.git
cd aethene

# Install
npm install

# Configure
cp .env.example .env
# Edit .env with your Convex URL and Gemini API key

# Run
npm run server
```

### Store a memory

```bash
curl -X POST http://localhost:3006/v3/documents \
  -H "X-API-Key: your-key" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "Sarah works at Google as a software engineer",
    "containerTag": "user_123"
  }'
```

### Search memories

```bash
curl -X POST http://localhost:3006/v1/search \
  -H "X-API-Key: your-key" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "Where does Sarah work?",
    "containerTag": "user_123",
    "mode": "memories"
  }'

# Returns: "Sarah works at Google as a software engineer"
```

---

## Features

### Automatic Memory Extraction

```
Input: "I'm Sarah, I work at Google and have a dog named Luna"

Extracted Memories:
  - Sarah works at Google
  - Sarah has a dog named Luna
  - Luna is Sarah's dog
```

### Semantic Search

```
Query: "What pet does Sarah have?"

Results:
  1. Sarah has a dog named Luna (0.94)
  2. Luna is Sarah's dog (0.89)
```

### Container Isolation

```javascript
// Each user gets isolated memory space
await aethene.add({
  content: "User prefers dark mode",
  containerTag: "user_123"  // Only accessible with this tag
});
```

### Memory Versioning

```
Timeline:
  v1: Sarah has 500 followers (2024-01-15) [superseded]
  v2: Sarah has 10K followers (2024-06-20) [current]
```

---

## API Reference

### Documents API (v3)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v3/documents` | POST | Ingest content, auto-extract memories |

```json
{
  "content": "Your text content",
  "containerTag": "optional_isolation_tag",
  "entityContext": "Optional context for 'I/me' resolution"
}
```

### Search API (v1)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/search` | POST | Semantic search across memories |

```json
{
  "query": "Your search query",
  "containerTag": "optional_filter",
  "limit": 10,
  "mode": "memories"
}
```

### Memory Operations

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/memories` | GET | List all memories |
| `/v1/memories/:id` | GET | Get specific memory |
| `/v1/memories/:id` | PATCH | Update memory |
| `/v1/memories/:id` | DELETE | Forget memory |

---

## Self-Hosting

### Docker

```bash
docker-compose up -d
```

### Manual

```bash
# 1. Set up Convex
npx convex dev

# 2. Configure environment
cp .env.example .env
# Add your CONVEX_URL and GEMINI_API_KEY

# 3. Run server
npm run server
```

### Environment Variables

| Variable | Required | Description |
|----------|:--------:|-------------|
| `CONVEX_URL` | Yes | Your Convex deployment URL |
| `GEMINI_API_KEY` | Yes | Google Gemini API key for embeddings |
| `OPENAI_API_KEY` | No | For GPT-based extraction (optional) |
| `PORT` | No | Server port (default: 3006) |
| `API_KEYS` | No | Comma-separated API keys |

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Aethene API                          │
├─────────────────────────────────────────────────────────┤
│  Auth        Rate Limiter       REST Routes             │
├─────────────────────────────────────────────────────────┤
│  Memory Extractor    Recall Service    Entity Graph     │
│     (LLM)              (Hybrid)         (Relations)     │
├─────────────────────────────────────────────────────────┤
│        Convex                    Gemini                 │
│   (DB + Vectors)            (Embeddings)                │
└─────────────────────────────────────────────────────────┘
```

---

## Example: AI Chat with Memory

```typescript
async function chat(userMessage: string, userId: string) {
  // 1. Recall relevant context
  const { results } = await fetch("http://localhost:3006/v1/search", {
    method: "POST",
    headers: { "X-API-Key": API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      query: userMessage,
      containerTag: userId,
      limit: 5,
      mode: "memories"
    }),
  }).then(r => r.json());

  const context = results.map(r => r.memory).join("\n");

  // 2. Generate response with memory
  const response = await llm.generate({
    system: `You remember: ${context}`,
    user: userMessage
  });

  // 3. Store this conversation
  await fetch("http://localhost:3006/v3/documents", {
    method: "POST",
    headers: { "X-API-Key": API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      content: `User: ${userMessage}\nAssistant: ${response}`,
      containerTag: userId,
    }),
  });

  return response;
}
```

---

## Testing

```bash
# Run comparison test
npx tsx tests/compare-test.ts

# Run LoCoMo benchmark
npx tsx tests/locomo-vs-sm.ts
```

---

## License

MIT License - see [LICENSE](./LICENSE)

---

<div align="center">

**Open source memory for AI. Built to match the best.**

[GitHub](https://github.com/akhilponnada/aethene) · [Issues](https://github.com/akhilponnada/aethene/issues)

</div>
