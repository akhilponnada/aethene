# Aethene

**The AI Memory Layer API**

Aethene is a commercial memory API that provides persistent, intelligent memory capabilities for AI applications. Store, search, and recall information with automatic memory extraction, versioning, and semantic search.

## Features

- **Intelligent Memory Extraction** - Automatically extracts facts, preferences, and events from content
- **Hybrid Search** - Combines vector similarity with recency boosting for accurate recall
- **Memory Versioning** - Tracks changes over time with automatic contradiction detection
- **Multi-tenant Isolation** - Container tags for secure data isolation per user/context
- **Scoped API Keys** - Fine-grained access control with permissions and rate limits
- **Fast & Scalable** - Built on Convex for real-time, serverless performance

## API Endpoints

All endpoints are under `/v1/*`:

### Memories

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/memories` | POST | Create memories |
| `/v1/memories` | GET | List memories |
| `/v1/memories/:id` | GET | Get specific memory |
| `/v1/memories/:id` | PATCH | Update memory |
| `/v1/memories/:id/forget` | POST | Soft delete memory |

### Documents

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/documents` | POST | Create document from text |
| `/v1/documents/file` | POST | Upload file (multipart) |
| `/v1/documents/list` | POST | List documents (paginated) |
| `/v1/documents/:id` | GET | Get document |
| `/v1/documents/:id` | PATCH | Update document |
| `/v1/documents/:id` | DELETE | Delete document |
| `/v1/documents/bulk` | DELETE | Bulk delete |
| `/v1/documents/search` | POST | Search documents |

### Search & Recall

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/search` | POST | Search memories and documents |
| `/v1/recall` | POST | Intelligent memory recall |
| `/v1/profile` | GET | User memory profile |
| `/v1/context` | POST | LLM-ready context |

### Settings & Auth

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/settings` | GET | Get user settings |
| `/v1/settings` | PATCH | Update settings |
| `/v1/auth/keys` | POST | Create API key |
| `/v1/auth/keys` | GET | List API keys |
| `/v1/auth/keys/:id` | DELETE | Revoke API key |
| `/v1/auth/key-info` | GET | Current key info |

## Authentication

All API endpoints require authentication via API key:

```bash
curl -X POST https://api.aethene.com/v1/search \
  -H "X-API-Key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"query": "What do you know about React?"}'
```

Or use Bearer token:

```bash
curl -X POST https://api.aethene.com/v1/search \
  -H "Authorization: Bearer your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"query": "What do you know about React?"}'
```

## Quick Start (Self-Hosted)

```bash
# Clone the repository
git clone https://github.com/aethene/aethene-api.git
cd aethene-api

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your Convex URL and API keys

# Start the server
npm run server

# Or with Docker
docker-compose up -d
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `CONVEX_URL` | Yes | Convex database URL |
| `GEMINI_API_KEY` | Yes | Google Gemini API key for embeddings |
| `PORT` | No | Server port (default: 3006) |
| `API_KEYS` | No | Static API keys for development |
| `CORS_ORIGINS` | No | Allowed CORS origins (comma-separated) |
| `NODE_ENV` | No | Environment (development/production) |

## Rate Limits

- Global: 1000 requests per 15 minutes
- Per-key: Configurable via API key settings

## Security

- API key authentication with scoped permissions
- CORS configuration for production
- SSRF protection for URL fetching
- Request body size limits (10MB)
- Security headers (CSP, HSTS, X-Frame-Options)

## License

Proprietary - All rights reserved.

For licensing inquiries, contact: hello@aethene.com
