import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SYSTEM_PROMPT_V5 } from '@/lib/ai/system-prompts';

const migrationUrl = new URL(
  '../../supabase/migrations/20260714000001_add_system_prompt_v5.sql',
  import.meta.url,
);
const migration = existsSync(migrationUrl) ? readFileSync(migrationUrl, 'utf8') : '';

function extractPrompt(sql: string): string {
  return sql.match(/\$prompt\$([\s\S]*?)\$prompt\$/)?.[1] ?? '';
}

describe('System Prompt v5 migration', () => {
  it('switches the singleton default before inserting v5', () => {
    const unsetIndex = migration.indexOf('UPDATE generation_system_prompts SET is_default = false');
    const insertIndex = migration.indexOf('INSERT INTO generation_system_prompts');
    expect(unsetIndex).toBeGreaterThanOrEqual(0);
    expect(insertIndex).toBeGreaterThan(unsetIndex);
    expect(migration).toMatch(/'System Prompt v5'[\s\S]+TRUE/);
  });

  it('retains previous prompt rows', () => {
    expect(migration).not.toMatch(/DELETE\s+FROM\s+generation_system_prompts/i);
    expect(migration).not.toMatch(/UPDATE[\s\S]+content\s*=/i);
  });

  it('stores exactly the canonical fallback prompt', () => {
    expect(extractPrompt(migration)).toBe(SYSTEM_PROMPT_V5);
  });

  it('is transactional', () => {
    expect(migration.trimStart()).toMatch(/^BEGIN;/);
    expect(migration.trimEnd()).toMatch(/COMMIT;$/);
  });
});
