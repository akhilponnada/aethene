# Aethene MCP Server

Model Context Protocol (MCP) server for integrating Aethene with Claude Code.

## Features

- **aethene_search**: Semantic search across memories
- **aethene_save**: Save new memories with automatic extraction
- **aethene_profile**: Get user profile (static + dynamic memories)
- **aethene_recall**: Combined search + profile retrieval
- **aethene_forget**: Delete/forget specific memories

## Installation

### Option 1: Install globally

```bash
cd mcp-server
npm install
npm run build
npm link
```

### Option 2: Run directly

```bash
npx tsx src/index.ts
```

## Configuration

Set environment variables:

```bash
export AETHENE_URL=http://localhost:3006
export AETHENE_API_KEY=your_api_key
```

## Claude Code Integration

Add to your Claude Code settings (`~/.claude/settings.json`):

```json
{
  "mcpServers": {
    "aethene": {
      "command": "aethene-mcp",
      "env": {
        "AETHENE_URL": "http://localhost:3006",
        "AETHENE_API_KEY": "your_api_key"
      }
    }
  }
}
```

Or if running from source:

```json
{
  "mcpServers": {
    "aethene": {
      "command": "npx",
      "args": ["tsx", "/path/to/aethene/mcp-server/src/index.ts"],
      "env": {
        "AETHENE_URL": "http://localhost:3006",
        "AETHENE_API_KEY": "your_api_key"
      }
    }
  }
}
```

## Usage in Claude Code

Once configured, Claude will have access to Aethene memory tools:

```
Claude, search my memories for "authentication implementation"
```

```
Claude, save this memory: "User prefers TypeScript over JavaScript"
```

```
Claude, show my profile
```

## Tool Reference

### aethene_search

Search memories semantically.

**Parameters:**
- `query` (required): Search query
- `limit`: Max results (default: 10)
- `threshold`: Min similarity 0-1 (default: 0.5)
- `userId`: User ID for multi-tenant

### aethene_save

Save new memories.

**Parameters:**
- `content` (required): Information to remember
- `isCore`: Mark as permanent memory (default: false)
- `userId`: User ID for multi-tenant

### aethene_profile

Get user profile.

**Parameters:**
- `q`: Filter query
- `includeRecent`: Include dynamic memories (default: true)
- `userId`: User ID for multi-tenant

### aethene_recall

Search + profile in one call.

**Parameters:**
- `query` (required): Search query
- `limit`: Max results (default: 10)
- `includeProfile`: Include profile (default: true)
- `userId`: User ID for multi-tenant

### aethene_forget

Delete a memory.

**Parameters:**
- `id` (required): Memory ID to forget

## License

Apache-2.0
