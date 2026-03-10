import { describe, expect, it } from 'vitest';
import type { Context } from 'hono';
import {
  normalizeContainerTagInput,
  resolveRequestedContainerTags,
  resolveRequestedUserId,
} from './auth.js';

function createMockContext(values: Record<string, unknown>): Context {
  return {
    get(key: string) {
      return values[key];
    },
    json(body: unknown, status?: number) {
      return new Response(JSON.stringify(body), { status });
    },
  } as unknown as Context;
}

describe('normalizeContainerTagInput', () => {
  it('parses comma-separated and JSON-array inputs', () => {
    expect(normalizeContainerTagInput('alpha,beta , gamma')).toEqual(['alpha', 'beta', 'gamma']);
    expect(normalizeContainerTagInput('["alpha","beta"]')).toEqual(['alpha', 'beta']);
  });
});

describe('resolveRequestedContainerTags', () => {
  it('defaults scoped writes to the first allowed tag when omitted', () => {
    const c = createMockContext({
      isScoped: true,
      containerTags: ['workspace-a', 'workspace-b'],
    });

    const result = resolveRequestedContainerTags(c, undefined, { defaultToFirstAllowed: true });

    expect(result.response).toBeNull();
    expect(result.containerTags).toEqual(['workspace-a']);
  });

  it('rejects disallowed scoped container tags', async () => {
    const c = createMockContext({
      isScoped: true,
      containerTags: ['workspace-a'],
    });

    const result = resolveRequestedContainerTags(c, 'workspace-b');

    expect(result.containerTags).toEqual([]);
    expect(result.response?.status).toBe(403);
    await expect(result.response?.json()).resolves.toMatchObject({
      code: 'CONTAINER_ACCESS_DENIED',
      allowedTags: ['workspace-a'],
    });
  });
});

describe('resolveRequestedUserId', () => {
  it('keeps scoped keys pinned to their scoped user namespace', () => {
    const c = createMockContext({
      userId: 'scoped-parent-workspace-a',
      isScoped: true,
      containerTags: ['workspace-a'],
      permissions: ['read'],
    });

    expect(resolveRequestedUserId(c, undefined, 'workspace-a')).toBe('scoped-parent-workspace-a');
  });

  it('still allows unscoped keys to use containerTag as a compatibility userId override', () => {
    const c = createMockContext({
      userId: 'primary-user',
      isScoped: false,
      containerTags: [],
      permissions: ['admin'],
    });

    expect(resolveRequestedUserId(c, undefined, 'workspace-a')).toBe('workspace-a');
  });
});
