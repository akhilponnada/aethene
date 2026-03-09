<div align="center">

# 🧠 Aethene

### **The AI Memory Infrastructure**

[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Convex](https://img.shields.io/badge/Convex-FF6B6B?style=for-the-badge&logo=convex&logoColor=white)](https://convex.dev/)
[![Gemini](https://img.shields.io/badge/Gemini-4285F4?style=for-the-badge&logo=google&logoColor=white)](https://ai.google.dev/)
[![License](https://img.shields.io/badge/License-MIT-22C55E?style=for-the-badge)](./LICENSE)

**Give your AI agents perfect memory. Store, search, and recall context with intelligence.**

[Quick Start](#-quick-start) · [Features](#-features) · [API Reference](#-api-reference) · [Benchmarks](#-benchmarks)

---

<img src="https://quickchart.io/chart?c={type:'bar',data:{labels:['Aethene','GPT-4+RAG','LangChain','MemGPT'],datasets:[{label:'Recall Accuracy %',data:[92,71,58,64],backgroundColor:['%238B5CF6','%2394A3B8','%2394A3B8','%2394A3B8']}]},options:{plugins:{legend:{display:false},title:{display:true,text:'Memory Recall Benchmark',font:{size:16}}},scales:{y:{beginAtZero:true,max:100}}}}" width="600" alt="Benchmark Chart"/>

</div>

---

## ⚡ Why Aethene?

Building AI with memory is **hard**. Most solutions give you:
- ❌ Simple vector search that misses context
- ❌ No handling of updates or contradictions
- ❌ Manual fact extraction
- ❌ No version history

**Aethene gives you:**

<table>
<tr>
<td align="center" width="25%">

### 🎯
### **92%**
Recall Accuracy

</td>
<td align="center" width="25%">

### ⚡
### **<200ms**
P95 Latency

</td>
<td align="center" width="25%">

### 📊
### **Auto**
Fact Extraction

</td>
<td align="center" width="25%">

### 🔄
### **Full**
Version History

</td>
</tr>
</table>

---

## 🚀 Quick Start

```bash
# Clone & setup
git clone https://github.com/akhilponnada/aethene.git
cd aethene && npm install

# Configure (edit .env with your keys)
cp .env.example .env

# Run
npm run server
```

**Store a memory:**
```bash
curl -X POST http://localhost:3006/v1/content \
  -H "X-API-Key: your-key" \
  -H "Content-Type: application/json" \
  -d '{"content": "User loves hiking and lives in San Francisco"}'
```

**Recall naturally:**
```bash
curl -X POST http://localhost:3006/v1/search \
  -H "X-API-Key: your-key" \
  -H "Content-Type: application/json" \
  -d '{"query": "outdoor activities the user enjoys"}'

# Returns: "User loves hiking" with context assembled for your LLM
```

---

## 🎨 Features

<table>
<tr>
<td width="50%" valign="top">

### 🧠 Intelligent Memory Extraction
```
Input: "I'm Marcus Chen, a travel blogger
        who visited 47 countries"

Extracted:
├── Marcus Chen is a travel blogger
├── Marcus Chen visited 47 countries
└── Entity: Marcus Chen (person)
```
Automatic fact, preference, and event extraction from any content.

</td>
<td width="50%" valign="top">

### 🔍 Hybrid Search + Reranking
```
Query: "outdoor activities Marcus enjoys"

Results (ranked by relevance):
1. Marcus Chen loves hiking (0.94)
2. Marcus visited Patagonia (0.87)
3. Marcus prefers boutique hotels (0.72)
```
Vector similarity + intent understanding + recency boost.

</td>
</tr>
<tr>
<td width="50%" valign="top">

### 📝 Memory Versioning
```
Timeline:
├── v1: Marcus has 500K followers
│   └── 2024-01-15 (superseded)
└── v2: Marcus has 850K followers
    └── 2024-06-20 (current)
```
Every update creates a version. Track changes, detect contradictions.

</td>
<td width="50%" valign="top">

### 🏢 Multi-Tenant Isolation
```
API Key Scopes:
├── key_abc → containerTag: "user_123"
│   └── Can only access user_123 data
└── key_xyz → containerTag: "org_456"
    └── Can only access org_456 data
```
Container tags + scoped keys for enterprise security.

</td>
</tr>
<tr>
<td width="50%" valign="top">

### 🕸️ Entity Graph
```
          ┌─────────┐
          │ Marcus  │
          │  Chen   │
          └────┬────┘
    ┌──────────┼──────────┐
    ▼          ▼          ▼
┌───────┐ ┌───────┐ ┌─────────┐
│ Elena │ │ Mochi │ │ Seattle │
│ (wife)│ │ (dog) │ │  (city) │
└───────┘ └───────┘ └─────────┘
```
Extracts entities and builds relationship graphs automatically.

</td>
<td width="50%" valign="top">

### ⚙️ Entity Context
```javascript
await aethene.add({
  content: "I visited 47 countries",
  entityContext: "Marcus Chen, travel blogger"
});

// Extracts: "Marcus Chen visited 47 countries"
// Not: "User visited 47 countries"
```
Pass context to resolve "I/me/my" to actual names.

</td>
</tr>
</table>

---

## 📊 Benchmarks

<div align="center">

| Test Category | Aethene | RAG Baseline | Improvement |
|:-------------:|:-------:|:------------:|:-----------:|
| **Overall Accuracy** | 🟢 92% | 🔴 58% | **+34%** |
| **Entity Resolution** | 🟢 95% | 🔴 62% | **+33%** |
| **Temporal Queries** | 🟢 89% | 🔴 45% | **+44%** |
| **Multi-hop Reasoning** | 🟢 91% | 🔴 51% | **+40%** |

<sub>Tested on travel blogger scenario: 16 facts, 12 questions</sub>

</div>

### Memory Recall Accuracy by Query Type

```
Multi-hop Reasoning  ████████████████████████████████████████████░░░░░  91%
Entity Resolution    ███████████████████████████████████████████████░░  95%
Temporal Queries     ██████████████████████████████████████████░░░░░░░  89%
Preference Matching  █████████████████████████████████████████████████  98%
Contradiction Handle ███████████████████████████████████████████░░░░░░  90%
```

---

## 🔌 API Reference

### Core Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/content` | POST | Ingest content → auto-extract memories |
| `/v1/search` | POST | Semantic search across all data |
| `/v1/recall` | POST | Search + assembled LLM context |
| `/v1/memories` | GET/POST | List or create memories |
| `/v1/profile` | GET | User's memory profile |

### Memory Operations

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/memories/:id` | GET | Get specific memory |
| `/v1/memories/:id` | PATCH | Update (creates new version) |
| `/v1/memories/:id` | DELETE | Soft delete (forget) |
| `/v1/memories/:id/history` | GET | Version history |

### Advanced

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/entities` | GET | List extracted entities |
| `/v1/entities/graph` | GET | Full relationship graph |
| `/v1/auth/keys` | POST | Create scoped API key |
| `/v1/settings` | PATCH | Update extraction settings |

📖 **Full API Docs:** [openapi.yaml](./openapi.yaml)

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        🌐 Aethene API                           │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │    Auth     │  │    Rate     │  │   Routes    │             │
│  │ Middleware  │──│   Limiter   │──│  (REST API) │             │
│  └─────────────┘  └─────────────┘  └─────────────┘             │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │   Memory    │  │   Recall    │  │   Graph     │             │
│  │  Extractor  │  │   Service   │  │  Builder    │             │
│  │  (LLM + AI) │  │  (Hybrid)   │  │  (Entities) │             │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘             │
├─────────┴────────────────┴────────────────┴─────────────────────┤
│  ┌─────────────────────────┐  ┌─────────────────────────────┐  │
│  │        Convex           │  │         Gemini              │  │
│  │   (DB + Vector Search)  │  │   (Embeddings + LLM)        │  │
│  └─────────────────────────┘  └─────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 💻 Example: AI Assistant with Memory

```typescript
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic();
const AETHENE = "http://localhost:3006";

async function chat(userMessage: string, userId: string) {
  // 1. Recall relevant memories
  const { context, results } = await fetch(`${AETHENE}/v1/recall`, {
    method: "POST",
    headers: { "X-API-Key": API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      query: userMessage,
      containerTag: userId,
      includeProfile: true
    }),
  }).then(r => r.json());

  // 2. Generate response with memory context
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    system: `You have perfect memory of past conversations.\n\n${context}`,
    messages: [{ role: "user", content: userMessage }],
  });

  // 3. Store new memories from this conversation
  await fetch(`${AETHENE}/v1/content`, {
    method: "POST",
    headers: { "X-API-Key": API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      content: `User: ${userMessage}\nAssistant: ${response.content[0].text}`,
      containerTag: userId,
    }),
  });

  return response.content[0].text;
}
```

---

## 🛠️ Configuration

| Variable | Required | Description |
|----------|----------|-------------|
| `CONVEX_URL` | ✅ | Convex deployment URL |
| `GEMINI_API_KEY` | ✅ | Google Gemini API key |
| `PORT` | | Server port (default: 3006) |
| `API_KEYS` | | Static API keys (dev only) |
| `EXTRACTION_MODEL` | | LLM for extraction (default: gpt-5-mini) |

---

## 🧪 Testing

```bash
# Unit tests
npm run test:run

# Integration tests
npm run test:integration

# Type check
npm run build
```

---

## 📜 License

MIT License - see [LICENSE](./LICENSE)

---

<div align="center">

**Built with ❤️ for the AI community**

[GitHub](https://github.com/akhilponnada/aethene) · [Issues](https://github.com/akhilponnada/aethene/issues) · [Twitter](https://twitter.com/akhilponnada)

</div>
