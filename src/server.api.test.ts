import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockInitializeDb,
  mockQueryConvex,
  mockExtractAndSaveMemories,
  mockIngestContent,
} = vi.hoisted(() => ({
  mockInitializeDb: vi.fn(),
  mockQueryConvex: vi.fn(),
  mockExtractAndSaveMemories: vi.fn(),
  mockIngestContent: vi.fn(),
}));

vi.mock('./database/db.js', () => ({
  initializeDb: mockInitializeDb,
  queryConvex: mockQueryConvex,
  mutateConvex: vi.fn(),
  actionConvex: vi.fn(),
  getConvexClient: vi.fn(),
}));

vi.mock('./services/memory-extractor.js', () => ({
  extractAndSaveMemories: mockExtractAndSaveMemories,
}));

vi.mock('./services/ingest-service.js', () => ({
  ingestContent: mockIngestContent,
}));

import { createApp } from './server.js';

function configureAuthMocks() {
  mockQueryConvex.mockImplementation(async (funcName: string, args: { key?: string }) => {
    if (funcName !== 'apiKeys:validate') {
      return null;
    }

    if (args.key === 'scoped-write-key') {
      return {
        valid: true,
        userId: 'scoped-parent-workspace-a',
        rateLimit: 100,
        isScoped: true,
        containerTags: ['workspace-a'],
        permissions: ['write'],
      };
    }

    if (args.key === 'scoped-read-key') {
      return {
        valid: true,
        userId: 'scoped-parent-workspace-a',
        rateLimit: 100,
        isScoped: true,
        containerTags: ['workspace-a'],
        permissions: ['read'],
      };
    }

    return null;
  });
}

async function requestJson(
  app: ReturnType<typeof createApp>,
  path: string,
  init?: RequestInit
) {
  const response = await app.request(path, init);
  const data = await response.json() as any;
  return { response, data };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NODE_ENV = 'test';
  process.env.API_KEYS = '';
  delete process.env.ENABLE_PUBLIC_DEEP_HEALTHCHECK;

  configureAuthMocks();

  mockExtractAndSaveMemories.mockResolvedValue({
    memories: [
      {
        id: 'mem_1',
        content: 'User prefers tea',
        isCore: true,
      },
    ],
  });

  mockIngestContent.mockResolvedValue({
    id: 'doc_1',
    status: 'queued',
    workflowInstanceId: 'wf_1',
  });
});

describe('Aethene API surface', () => {
  it('serves public health info without auth', async () => {
    const app = createApp();
    const { response, data } = await requestJson(app, '/health');

    expect(response.status).toBe(200);
    expect(data).toMatchObject({
      status: 'healthy',
      service: 'aethene',
      version: '1.0.0',
    });
  });

  it('rejects protected routes without an API key', async () => {
    const app = createApp();
    const { response, data } = await requestJson(app, '/v1/memories');

    expect(response.status).toBe(401);
    expect(data.error).toBe('Missing API key');
  });

  it('returns static-key info for authenticated requests', async () => {
    process.env.API_KEYS = 'static-test-key';

    const app = createApp();
    const { response, data } = await requestJson(app, '/v1/auth/key-info', {
      headers: {
        Authorization: 'Bearer static-test-key',
      },
    });

    expect(response.status).toBe(200);
    expect(data).toMatchObject({
      success: true,
      isScoped: false,
      permissions: ['read', 'write', 'delete', 'admin'],
      userId: 'static-test-key',
    });
  });

  it('defaults scoped memory writes to the first allowed container tag', async () => {
    const app = createApp();
    const { response, data } = await requestJson(app, '/v1/memories', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer scoped-write-key',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        memories: [
          {
            content: 'User prefers tea',
            isCore: true,
          },
        ],
      }),
    });

    expect(response.status).toBe(201);
    expect(data).toMatchObject({
      success: true,
      created: 1,
    });
    expect(mockExtractAndSaveMemories).toHaveBeenCalledWith(
      'scoped-parent-workspace-a',
      'User prefers tea',
      expect.objectContaining({
        forceIsCore: true,
        containerTags: ['workspace-a'],
      })
    );
  });

  it('blocks scoped document writes outside the allowed container tag', async () => {
    const app = createApp();
    const { response, data } = await requestJson(app, '/v1/documents', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer scoped-write-key',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        content: 'Blocked document',
        containerTag: 'workspace-b',
      }),
    });

    expect(response.status).toBe(403);
    expect(data).toMatchObject({
      code: 'CONTAINER_ACCESS_DENIED',
      allowedTags: ['workspace-a'],
    });
    expect(mockIngestContent).not.toHaveBeenCalled();
  });

  it('blocks write routes for scoped read-only keys', async () => {
    const app = createApp();
    const { response, data } = await requestJson(app, '/v1/documents', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer scoped-read-key',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        content: 'Should not be allowed',
      }),
    });

    expect(response.status).toBe(403);
    expect(data).toMatchObject({
      code: 'INSUFFICIENT_PERMISSIONS',
    });
    expect(mockIngestContent).not.toHaveBeenCalled();
  });

  it('hides deep health checks in production unless explicitly enabled', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.ENABLE_PUBLIC_DEEP_HEALTHCHECK;

    const app = createApp();
    const { response, data } = await requestJson(app, '/health/deep', {
      headers: {
        'x-forwarded-for': 'deep-health-test',
      },
    });

    expect(response.status).toBe(404);
    expect(data).toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
