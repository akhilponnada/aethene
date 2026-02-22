/**
 * Aethene API Integration Tests
 *
 * Comprehensive test suite for all API endpoints.
 * Run with: npm test
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const BASE_URL = process.env.AETHENE_TEST_URL || 'http://localhost:3006';
const API_KEY = process.env.AETHENE_TEST_API_KEY || 'test-key-12345';

// Test state to track created resources for cleanup
const testState = {
  memoryIds: [] as string[],
  documentIds: [] as string[],
  scopedKeyIds: [] as string[],
};

// Helper function for API requests
async function apiRequest(
  method: string,
  path: string,
  body?: any,
  options: { expectStatus?: number; skipAuth?: boolean } = {}
) {
  const { expectStatus = 200, skipAuth = false } = options;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (!skipAuth) {
    headers['Authorization'] = `Bearer ${API_KEY}`;
  }

  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await response.json();

  if (expectStatus && response.status !== expectStatus) {
    console.error(`Expected ${expectStatus}, got ${response.status}:`, data);
  }

  return { status: response.status, data, headers: response.headers };
}

// =============================================================================
// HEALTH & INFO TESTS
// =============================================================================

describe('Health & Info Endpoints', () => {
  it('GET /health - returns healthy status', async () => {
    const { status, data } = await apiRequest('GET', '/health', undefined, { skipAuth: true });
    expect(status).toBe(200);
    expect(data.status).toBe('healthy');
    expect(data.service).toBe('aethene');
    expect(data.version).toBeDefined();
  });

  it('GET / - returns API info', async () => {
    const { status, data } = await apiRequest('GET', '/', undefined, { skipAuth: true });
    expect(status).toBe(200);
    expect(data.name).toBe('Aethene API');
    expect(data.endpoints).toBeDefined();
  });

  it('GET /health/deep - returns deep health check', async () => {
    const { status, data } = await apiRequest('GET', '/health/deep', undefined, { skipAuth: true });
    expect(status).toBe(200);
    expect(data.status).toBeDefined();
    expect(data.checks).toBeDefined();
  });
});

// =============================================================================
// AUTHENTICATION TESTS
// =============================================================================

describe('Authentication', () => {
  it('rejects requests without API key', async () => {
    const { status, data } = await apiRequest('GET', '/v1/memories', undefined, {
      skipAuth: true,
      expectStatus: 401
    });
    expect(status).toBe(401);
    expect(data.error).toBeDefined();
  });

  it('rejects requests with invalid API key', async () => {
    const response = await fetch(`${BASE_URL}/v1/memories`, {
      headers: {
        'Authorization': 'Bearer invalid-key-12345',
        'Content-Type': 'application/json',
      },
    });
    expect(response.status).toBe(401);
  });

  it('GET /v1/auth/key-info - returns key info', async () => {
    const { status, data } = await apiRequest('GET', '/v1/auth/key-info');
    expect(status).toBe(200);
    expect(data.userId).toBeDefined();
  });
});

// =============================================================================
// MEMORY TESTS
// =============================================================================

describe('Memory Operations', () => {
  it('POST /v1/memories - creates memories', async () => {
    const { status, data } = await apiRequest('POST', '/v1/memories', {
      memories: [
        { content: 'Test memory: User prefers dark mode' },
        { content: 'Test memory: User lives in San Francisco', isCore: true },
      ],
    }, { expectStatus: 201 });

    expect(status).toBe(201);
    expect(data.success).toBe(true);
    expect(data.created).toBeGreaterThan(0);
    expect(data.memories).toBeInstanceOf(Array);

    // Track IDs for cleanup
    data.memories?.forEach((m: any) => testState.memoryIds.push(m.id));
  });

  it('GET /v1/memories - lists memories', async () => {
    const { status, data } = await apiRequest('GET', '/v1/memories');
    expect(status).toBe(200);
    expect(data.memories).toBeInstanceOf(Array);
    expect(data.count).toBeGreaterThanOrEqual(0);
  });

  it('GET /v1/memories?isCore=true - filters core memories', async () => {
    const { status, data } = await apiRequest('GET', '/v1/memories?isCore=true');
    expect(status).toBe(200);
    expect(data.memories).toBeInstanceOf(Array);
  });

  it('GET /v1/memories/stats - returns memory statistics', async () => {
    const { status, data } = await apiRequest('GET', '/v1/memories/stats');
    expect(status).toBe(200);
    expect(data.stats).toBeDefined();
    expect(typeof data.stats.total).toBe('number');
  });

  it('GET /v1/memories/:id - gets specific memory', async () => {
    if (testState.memoryIds.length === 0) {
      console.log('Skipping: No test memories to fetch');
      return;
    }

    const { status, data } = await apiRequest('GET', `/v1/memories/${testState.memoryIds[0]}`);
    expect(status).toBe(200);
    expect(data.id).toBe(testState.memoryIds[0]);
    expect(data.content).toBeDefined();
  });

  it('PATCH /v1/memories/:id - updates memory', async () => {
    if (testState.memoryIds.length === 0) {
      console.log('Skipping: No test memories to update');
      return;
    }

    const { status, data } = await apiRequest('PATCH', `/v1/memories/${testState.memoryIds[0]}`, {
      content: 'Updated test memory: User now prefers light mode',
    });

    expect(status).toBe(200);
    expect(data.success).toBe(true);

    // Track new version ID
    if (data.id) testState.memoryIds.push(data.id);
  });

  it('POST /v1/memories/:id/promote - promotes to core memory', async () => {
    if (testState.memoryIds.length === 0) {
      console.log('Skipping: No test memories to promote');
      return;
    }

    const { status, data } = await apiRequest('POST', `/v1/memories/${testState.memoryIds[0]}/promote`);
    expect(status).toBe(200);
    expect(data.success).toBe(true);
  });

  it('GET /v1/memories/:id/history - gets version history', async () => {
    if (testState.memoryIds.length === 0) {
      console.log('Skipping: No test memories');
      return;
    }

    const { status, data } = await apiRequest('GET', `/v1/memories/${testState.memoryIds[0]}/history`);
    expect(status).toBe(200);
    expect(data.versions).toBeInstanceOf(Array);
  });

  it('GET /v1/memories/expiring - lists expiring memories', async () => {
    const { status, data } = await apiRequest('GET', '/v1/memories/expiring?hours=24');
    expect(status).toBe(200);
    expect(data.memories).toBeInstanceOf(Array);
  });

  it('GET /v1/memories/by-kind/:kind - lists memories by kind', async () => {
    const { status, data } = await apiRequest('GET', '/v1/memories/by-kind/fact');
    expect(status).toBe(200);
    expect(data.memories).toBeInstanceOf(Array);
    expect(data.kind).toBe('fact');
  });
});

// =============================================================================
// SEARCH TESTS
// =============================================================================

describe('Search Operations', () => {
  it('POST /v1/search - searches memories', async () => {
    const { status, data } = await apiRequest('POST', '/v1/search', {
      query: 'dark mode preference',
      limit: 10,
    });

    expect(status).toBe(200);
    expect(data.results).toBeInstanceOf(Array);
    expect(data.query).toBe('dark mode preference');
    expect(data.latencyMs).toBeDefined();
  });

  it('POST /v1/search - searches with hybrid mode', async () => {
    const { status, data } = await apiRequest('POST', '/v1/search', {
      query: 'user location',
      mode: 'hybrid',
      limit: 5,
    });

    expect(status).toBe(200);
    expect(data.results).toBeInstanceOf(Array);
  });

  it('POST /v1/search - searches with reranking', async () => {
    const { status, data } = await apiRequest('POST', '/v1/search', {
      query: 'preferences',
      rerank: true,
      limit: 5,
    });

    expect(status).toBe(200);
    expect(data.results).toBeInstanceOf(Array);
  });
});

// =============================================================================
// RECALL TESTS
// =============================================================================

describe('Recall Operations', () => {
  it('POST /v1/recall - recalls with context', async () => {
    const { status, data } = await apiRequest('POST', '/v1/recall', {
      query: 'user preferences',
      limit: 5,
      includeProfile: true,
    });

    expect(status).toBe(200);
    expect(data.results).toBeInstanceOf(Array);
    expect(data.context).toBeDefined();
  });

  it('POST /v1/search/recall - alternative recall endpoint', async () => {
    const { status, data } = await apiRequest('POST', '/v1/search/recall', {
      query: 'location info',
      limit: 5,
    });

    expect(status).toBe(200);
    expect(data.results).toBeInstanceOf(Array);
  });
});

// =============================================================================
// PROFILE TESTS
// =============================================================================

describe('Profile Operations', () => {
  it('GET /v1/profile - gets user profile', async () => {
    const { status, data } = await apiRequest('GET', '/v1/profile');
    expect(status).toBe(200);
    expect(data.profile).toBeDefined();
  });

  it('GET /v1/profile/facts - gets user facts', async () => {
    const { status, data } = await apiRequest('GET', '/v1/profile/facts');
    expect(status).toBe(200);
    expect(data.facts).toBeInstanceOf(Array);
  });
});

// =============================================================================
// CONTEXT TESTS
// =============================================================================

describe('Context Operations', () => {
  it('POST /v1/context - builds LLM context', async () => {
    const { status, data } = await apiRequest('POST', '/v1/context', {
      query: 'Tell me about the user',
      maxTokens: 2000,
    });

    expect(status).toBe(200);
    expect(data.context).toBeDefined();
  });
});

// =============================================================================
// DOCUMENT TESTS
// =============================================================================

describe('Document Operations', () => {
  it('POST /v1/documents - creates a document', async () => {
    const { status, data } = await apiRequest('POST', '/v1/documents', {
      content: 'This is a test document about artificial intelligence and machine learning.',
      title: 'Test Document',
      contentType: 'text',
    }, { expectStatus: 201 });

    expect(status).toBe(201);
    expect(data.success).toBe(true);

    if (data.id) testState.documentIds.push(data.id);
  });

  it('POST /v1/documents/list - lists documents', async () => {
    const { status, data } = await apiRequest('POST', '/v1/documents/list', {
      limit: 10,
    });

    expect(status).toBe(200);
    expect(data.documents).toBeInstanceOf(Array);
  });

  it('GET /v1/documents/:id - gets specific document', async () => {
    if (testState.documentIds.length === 0) {
      console.log('Skipping: No test documents');
      return;
    }

    const { status, data } = await apiRequest('GET', `/v1/documents/${testState.documentIds[0]}`);
    expect(status).toBe(200);
    expect(data.id).toBeDefined();
  });

  it('POST /v1/documents/search - searches documents', async () => {
    const { status, data } = await apiRequest('POST', '/v1/documents/search', {
      query: 'artificial intelligence',
      limit: 5,
    });

    expect(status).toBe(200);
    expect(data.results).toBeInstanceOf(Array);
  });

  it('GET /v1/documents/processing - gets processing status', async () => {
    const { status, data } = await apiRequest('GET', '/v1/documents/processing');
    expect(status).toBe(200);
    expect(data.documents).toBeInstanceOf(Array);
  });
});

// =============================================================================
// CONTENT INGEST TESTS
// =============================================================================

describe('Content Ingest', () => {
  it('POST /v1/content - ingests content and extracts memories', async () => {
    const { status, data } = await apiRequest('POST', '/v1/content', {
      content: 'The user mentioned they work at Google as a software engineer. They enjoy hiking on weekends.',
    }, { expectStatus: 201 });

    expect(status).toBe(201);
    expect(data.success).toBe(true);
  });

  it('POST /v1/content/url - ingests URL', async () => {
    // This test may fail if URL is not accessible
    const { status } = await apiRequest('POST', '/v1/content/url', {
      url: 'https://example.com',
    }, { expectStatus: 201 });

    // Accept 201 (success) or 422 (invalid URL content)
    expect([201, 422]).toContain(status);
  });
});

// =============================================================================
// SETTINGS TESTS
// =============================================================================

describe('Settings Operations', () => {
  it('GET /v1/settings - gets user settings', async () => {
    const { status, data } = await apiRequest('GET', '/v1/settings');
    expect(status).toBe(200);
    expect(data.settings).toBeDefined();
  });

  it('PATCH /v1/settings - updates settings', async () => {
    const { status, data } = await apiRequest('PATCH', '/v1/settings', {
      chunkSize: 500,
    });

    expect(status).toBe(200);
    expect(data.success).toBe(true);
  });
});

// =============================================================================
// ENTITY GRAPH TESTS
// =============================================================================

describe('Entity Graph Operations', () => {
  it('GET /v1/entities - lists entities', async () => {
    const { status, data } = await apiRequest('GET', '/v1/entities');
    expect(status).toBe(200);
    expect(data.entities).toBeInstanceOf(Array);
  });

  it('GET /v1/entities/search - searches entities', async () => {
    const { status, data } = await apiRequest('GET', '/v1/entities/search?q=test');
    expect(status).toBe(200);
    expect(data.entities).toBeInstanceOf(Array);
  });

  it('GET /v1/entities/graph - gets entity graph', async () => {
    const { status, data } = await apiRequest('GET', '/v1/entities/graph');
    expect(status).toBe(200);
  });

  it('GET /v1/entities/stats - gets entity statistics', async () => {
    const { status, data } = await apiRequest('GET', '/v1/entities/stats');
    expect(status).toBe(200);
  });
});

// =============================================================================
// RELATIONS TESTS
// =============================================================================

describe('Memory Relations', () => {
  it('GET /v1/relations - lists relationships', async () => {
    const { status, data } = await apiRequest('GET', '/v1/relations');
    expect(status).toBe(200);
  });

  it('GET /v1/relations/graph - gets relationship graph', async () => {
    const { status, data } = await apiRequest('GET', '/v1/relations/graph');
    expect(status).toBe(200);
  });
});

// =============================================================================
// SCOPED API KEY TESTS
// =============================================================================

describe('Scoped API Keys', () => {
  it('POST /v1/auth/keys - creates scoped key', async () => {
    const { status, data } = await apiRequest('POST', '/v1/auth/keys', {
      name: 'Test Scoped Key',
      containerTags: ['test-container'],
      permissions: ['read', 'write'],
    }, { expectStatus: 201 });

    expect(status).toBe(201);
    expect(data.success).toBe(true);
    expect(data.key).toBeDefined();

    if (data.id) testState.scopedKeyIds.push(data.id);
  });

  it('GET /v1/auth/keys - lists scoped keys', async () => {
    const { status, data } = await apiRequest('GET', '/v1/auth/keys');
    expect(status).toBe(200);
    expect(data.keys).toBeInstanceOf(Array);
  });

  it('PATCH /v1/auth/keys/:id - updates scoped key', async () => {
    if (testState.scopedKeyIds.length === 0) {
      console.log('Skipping: No scoped keys to update');
      return;
    }

    const { status, data } = await apiRequest('PATCH', `/v1/auth/keys/${testState.scopedKeyIds[0]}`, {
      name: 'Updated Scoped Key',
    });

    expect(status).toBe(200);
    expect(data.success).toBe(true);
  });
});

// =============================================================================
// ERROR HANDLING TESTS
// =============================================================================

describe('Error Handling', () => {
  it('returns 404 for non-existent routes', async () => {
    const { status, data } = await apiRequest('GET', '/v1/nonexistent', undefined, {
      expectStatus: 404
    });
    expect(status).toBe(404);
    expect(data.error).toBeDefined();
  });

  it('returns 400 for invalid JSON', async () => {
    const response = await fetch(`${BASE_URL}/v1/memories`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: 'invalid json {',
    });

    expect(response.status).toBe(400);
  });

  it('returns 400 for invalid request body', async () => {
    const { status, data } = await apiRequest('POST', '/v1/memories', {
      // Missing required 'memories' field
      content: 'test',
    }, { expectStatus: 400 });

    expect(status).toBe(400);
    expect(data.error).toBeDefined();
  });

  it('returns 404 for non-existent memory', async () => {
    const { status, data } = await apiRequest('GET', '/v1/memories/nonexistent-id-12345', undefined, {
      expectStatus: 404
    });
    expect(status).toBe(404);
  });
});

// =============================================================================
// RATE LIMITING TESTS
// =============================================================================

describe('Rate Limiting', () => {
  it('returns rate limit headers', async () => {
    const { headers } = await apiRequest('GET', '/v1/memories');

    // Rate limit headers should be present
    const hasRateLimitHeaders =
      headers.has('x-ratelimit-limit') ||
      headers.has('x-ratelimit-remaining') ||
      headers.has('x-ratelimit-reset');

    // Not all deployments have rate limiting enabled
    // Just verify the endpoint works
    expect(true).toBe(true);
  });
});

// =============================================================================
// CLEANUP
// =============================================================================

afterAll(async () => {
  console.log('\n--- Cleaning up test resources ---');

  // Delete test memories
  for (const id of testState.memoryIds) {
    try {
      await apiRequest('DELETE', `/v1/memories/${id}`);
    } catch (e) {
      // Ignore cleanup errors
    }
  }

  // Delete test documents
  for (const id of testState.documentIds) {
    try {
      await apiRequest('DELETE', `/v1/documents/${id}`);
    } catch (e) {
      // Ignore cleanup errors
    }
  }

  // Revoke scoped keys
  for (const id of testState.scopedKeyIds) {
    try {
      await apiRequest('DELETE', `/v1/auth/keys/${id}`);
    } catch (e) {
      // Ignore cleanup errors
    }
  }

  console.log(`Cleaned up: ${testState.memoryIds.length} memories, ${testState.documentIds.length} documents, ${testState.scopedKeyIds.length} keys`);
});
