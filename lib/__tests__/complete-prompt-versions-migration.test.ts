import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  new URL(
    '../../supabase/migrations/20260714000004_seed_transparent_runtime_prompts.sql',
    import.meta.url,
  ),
  'utf8',
);

describe('complete prompt version migration', () => {
  it('versions complete content prompt state', () => {
    expect(sql).toMatch(/ADD COLUMN.*revision_number/);
    expect(sql).toMatch(/ADD COLUMN.*snapshot/);
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS current_revision_id');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS prompt_revision_id');
    for (const field of [
      'title',
      'content',
      'userPrompt',
      'position',
      'isAssembly',
      'isCritique',
      'isCorrector',
      'function',
      'notes',
      'sourceContext',
    ])
      expect(sql).toContain(`'${field}'`);
  });

  it('links every generated fragment to its exact execution', () => {
    expect(sql).toMatch(/ADD COLUMN.*execution_id/);
    expect(sql).toContain('REFERENCES llm_prompt_executions');
  });

  it('seeds visible runtime prompt kinds', () => {
    for (const kind of [
      'title',
      'placeholder-fill',
      'editorial-brief-extractor',
      'critique',
      'corrector',
    ])
      expect(sql).toContain(`'${kind}'`);
  });
});
