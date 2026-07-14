import { describe, expect, it, vi } from 'vitest';

// Mock the DB and auth modules so we can test route handler signatures
const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    transaction: vi.fn(),
  },
}));

vi.mock('@/lib/db', () => ({ db: mockDb }));

// Test that route handler modules export the correct HTTP method handlers
describe('prompt registry API routes', () => {
  it('prompt-definitions exports GET and POST', async () => {
    const mod = await import('@/app/api/prompt-definitions/route');
    expect(typeof mod.GET).toBe('function');
    expect(typeof mod.POST).toBe('function');
  });

  it('prompt-definitions/[id] exports GET and PATCH', async () => {
    const mod = await import('@/app/api/prompt-definitions/[id]/route');
    expect(typeof mod.GET).toBe('function');
    expect(typeof mod.PATCH).toBe('function');
  });

  it('prompt-definitions/[id]/revisions exports GET and POST', async () => {
    const mod = await import('@/app/api/prompt-definitions/[id]/revisions/route');
    expect(typeof mod.GET).toBe('function');
    expect(typeof mod.POST).toBe('function');
  });

  it('prompt-defaults/[kind] exports GET and PUT', async () => {
    const mod = await import('@/app/api/prompt-defaults/[kind]/route');
    expect(typeof mod.GET).toBe('function');
    expect(typeof mod.PUT).toBe('function');
  });

  it('projects/[id]/prompt-bindings exports GET, PUT and DELETE', async () => {
    const mod = await import('@/app/api/projects/[id]/prompt-bindings/route');
    expect(typeof mod.GET).toBe('function');
    expect(typeof mod.PUT).toBe('function');
    expect(typeof mod.DELETE).toBe('function');
  });

  it('prompt-executions exports GET', async () => {
    const mod = await import('@/app/api/prompt-executions/route');
    expect(typeof mod.GET).toBe('function');
  });

  it('prompt-executions/[id] exports GET', async () => {
    const mod = await import('@/app/api/prompt-executions/[id]/route');
    expect(typeof mod.GET).toBe('function');
  });
});

describe('prompt revision input validation', () => {
  it('rejects empty version label', async () => {
    const { promptRevisionInputSchema } = await import('@/lib/prompts/contracts');
    const result = promptRevisionInputSchema.safeParse({
      versionLabel: '',
      systemTemplate: 'test',
      userTemplate: 'test',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing system template', async () => {
    const { promptRevisionInputSchema } = await import('@/lib/prompts/contracts');
    const result = promptRevisionInputSchema.safeParse({
      versionLabel: '1.0',
      userTemplate: 'test',
    });
    expect(result.success).toBe(false);
  });

  it('accepts valid input', async () => {
    const { promptRevisionInputSchema } = await import('@/lib/prompts/contracts');
    const result = promptRevisionInputSchema.safeParse({
      versionLabel: '1.0',
      systemTemplate: 'SYS {{TEST}}',
      userTemplate: 'USER {{TEST}}',
      configuration: {},
    });
    expect(result.success).toBe(true);
  });
});
