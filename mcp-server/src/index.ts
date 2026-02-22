#!/usr/bin/env node
/**
 * Aethene MCP Server for Claude Code Integration
 *
 * Provides memory tools for Claude Code via Model Context Protocol (MCP)
 *
 * Tools:
 * - aethene_search: Search memories semantically
 * - aethene_save: Save new memories
 * - aethene_profile: Get user profile (static + dynamic memories)
 * - aethene_recall: Search with context assembly
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

// Configuration
const AETHENE_URL = process.env.AETHENE_URL || 'http://localhost:3006';
const AETHENE_API_KEY = process.env.AETHENE_API_KEY || '';

// Redirect console.log to stderr (MCP uses stdout for JSON-RPC)
const originalLog = console.log;
console.log = (...args: any[]) => {
  console.error('[aethene-mcp]', ...args);
};

/**
 * Call Aethene API
 */
async function callAetheneAPI(
  method: 'GET' | 'POST',
  endpoint: string,
  body?: Record<string, any>
): Promise<any> {
  const url = `${AETHENE_URL}${endpoint}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (AETHENE_API_KEY) {
    headers['X-API-Key'] = AETHENE_API_KEY;
  }

  try {
    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Aethene API error (${response.status}): ${errorText}`);
    }

    return await response.json();
  } catch (error) {
    throw new Error(`Aethene API call failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Tool definitions
 */
const tools = [
  {
    name: 'aethene_search',
    description: `Search user memories semantically. Use this when you need to recall past information, preferences, or context about the user.

Returns relevant memories ranked by similarity. Use 'limit' to control result count.

Examples:
- "What projects has the user worked on?"
- "User's programming preferences"
- "Recent conversations about authentication"`,
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Semantic search query (required)'
        },
        limit: {
          type: 'number',
          description: 'Max results to return (default: 10)'
        },
        threshold: {
          type: 'number',
          description: 'Minimum similarity score 0-1 (default: 0.5)'
        },
        userId: {
          type: 'string',
          description: 'User ID for multi-tenant setups (optional)'
        }
      },
      required: ['query']
    },
    handler: async (args: any) => {
      const result = await callAetheneAPI('POST', '/v1/search', {
        query: args.query,
        limit: args.limit || 10,
        threshold: args.threshold || 0.5,
        userId: args.userId,
      });

      const memories = result.results?.map((r: any) => ({
        id: r.id,
        content: r.content,
        score: r.score?.toFixed(3),
        type: r.type,
      })) || [];

      return {
        content: [{
          type: 'text' as const,
          text: memories.length > 0
            ? `Found ${memories.length} memories:\n\n${memories.map((m: any, i: number) =>
                `${i + 1}. [${m.score}] ${m.content}`
              ).join('\n\n')}`
            : 'No memories found matching your query.'
        }]
      };
    }
  },
  {
    name: 'aethene_save',
    description: `Save new information as a memory. Use this to remember:
- User preferences and settings
- Important facts about the user
- Project context and decisions
- Conversation highlights

The content will be automatically extracted into atomic facts.`,
    inputSchema: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: 'Information to remember (required). Can be natural language.'
        },
        isCore: {
          type: 'boolean',
          description: 'Mark as permanent/core memory (default: false)'
        },
        userId: {
          type: 'string',
          description: 'User ID for multi-tenant setups (optional)'
        }
      },
      required: ['content']
    },
    handler: async (args: any) => {
      const result = await callAetheneAPI('POST', '/v1/memories', {
        memories: [{ content: args.content, isCore: args.isCore }],
        userId: args.userId,
      });

      const created = result.memories || [];

      return {
        content: [{
          type: 'text' as const,
          text: created.length > 0
            ? `Saved ${created.length} memory/memories:\n${created.map((m: any) => `- ${m.content}`).join('\n')}`
            : 'Memory saved successfully.'
        }]
      };
    }
  },
  {
    name: 'aethene_profile',
    description: `Get user profile with static and dynamic memories.

Static memories: Permanent facts (name, preferences, skills)
Dynamic memories: Recent/contextual information

Use this at the start of conversations to understand the user.`,
    inputSchema: {
      type: 'object',
      properties: {
        q: {
          type: 'string',
          description: 'Optional query to filter profile memories'
        },
        includeRecent: {
          type: 'boolean',
          description: 'Include recent dynamic memories (default: true)'
        },
        userId: {
          type: 'string',
          description: 'User ID for multi-tenant setups (optional)'
        }
      }
    },
    handler: async (args: any) => {
      const params = new URLSearchParams();
      if (args.q) params.append('q', args.q);
      if (args.includeRecent !== undefined) params.append('includeRecent', String(args.includeRecent));
      if (args.userId) params.append('userId', args.userId);

      const result = await callAetheneAPI('GET', `/v1/profile?${params}`);

      const profile = result.profile || { static: [], dynamic: [] };

      let text = '## User Profile\n\n';

      if (profile.static.length > 0) {
        text += '### Core Facts\n';
        text += profile.static.map((s: string) => `- ${s}`).join('\n');
        text += '\n\n';
      }

      if (profile.dynamic.length > 0) {
        text += '### Recent Context\n';
        text += profile.dynamic.map((d: string) => `- ${d}`).join('\n');
      }

      if (profile.static.length === 0 && profile.dynamic.length === 0) {
        text = 'No profile information available for this user.';
      }

      return {
        content: [{
          type: 'text' as const,
          text
        }]
      };
    }
  },
  {
    name: 'aethene_recall',
    description: `Search memories AND get profile context in one call.

Use this for comprehensive context retrieval when you need both:
- Relevant memories for a specific query
- User's profile information

Returns formatted context ready for LLM consumption.`,
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query (required)'
        },
        limit: {
          type: 'number',
          description: 'Max memory results (default: 10)'
        },
        includeProfile: {
          type: 'boolean',
          description: 'Include user profile (default: true)'
        },
        userId: {
          type: 'string',
          description: 'User ID for multi-tenant setups (optional)'
        }
      },
      required: ['query']
    },
    handler: async (args: any) => {
      const result = await callAetheneAPI('POST', '/v1/search/recall', {
        query: args.query,
        limit: args.limit || 10,
        includeProfile: args.includeProfile !== false,
        userId: args.userId,
      });

      return {
        content: [{
          type: 'text' as const,
          text: result.context || 'No context available.'
        }]
      };
    }
  },
  {
    name: 'aethene_forget',
    description: `Delete/forget a specific memory by ID.

Use this when:
- User asks to forget something
- Information is outdated
- Memory was incorrectly saved`,
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Memory ID to forget (required)'
        }
      },
      required: ['id']
    },
    handler: async (args: any) => {
      await callAetheneAPI('POST', `/v1/memories/${args.id}`, {});

      return {
        content: [{
          type: 'text' as const,
          text: `Memory ${args.id} has been forgotten.`
        }]
      };
    }
  }
];

// Create MCP server
const server = new Server(
  {
    name: 'aethene-mcp',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Register tools/list handler
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema
    }))
  };
});

// Register tools/call handler
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const tool = tools.find(t => t.name === request.params.name);

  if (!tool) {
    throw new Error(`Unknown tool: ${request.params.name}`);
  }

  try {
    return await tool.handler(request.params.arguments || {});
  } catch (error) {
    console.error(`Tool ${request.params.name} failed:`, error);
    return {
      content: [{
        type: 'text' as const,
        text: `Error: ${error instanceof Error ? error.message : String(error)}`
      }],
      isError: true
    };
  }
});

// Parent heartbeat for orphan detection
const HEARTBEAT_INTERVAL_MS = 30_000;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

function startParentHeartbeat() {
  if (process.platform === 'win32') return;

  const initialPpid = process.ppid;
  heartbeatTimer = setInterval(() => {
    if (process.ppid === 1 || process.ppid !== initialPpid) {
      console.error('Parent process died, self-exiting');
      cleanup();
    }
  }, HEARTBEAT_INTERVAL_MS);

  if (heartbeatTimer.unref) heartbeatTimer.unref();
}

function cleanup() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  console.error('Aethene MCP server shutting down');
  process.exit(0);
}

process.on('SIGTERM', cleanup);
process.on('SIGINT', cleanup);

// Main entry point
async function main() {
  console.error('Starting Aethene MCP server...');
  console.error(`Aethene API: ${AETHENE_URL}`);
  console.error(`API Key: ${AETHENE_API_KEY ? '***configured***' : 'not set'}`);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error('Aethene MCP server started successfully');
  startParentHeartbeat();
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
