import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  new URL('../../supabase/migrations/20260714000002_add_prompt_registry.sql', import.meta.url),
  'utf8',
);

describe('prompt registry migration', () => {
  it('creates immutable registry and exact bindings', () => {
    for (const table of [
      'prompt_definitions',
      'prompt_revisions',
      'prompt_defaults',
      'project_prompt_bindings',
      'llm_prompt_executions',
    ])
      expect(sql).toContain(`CREATE TABLE ${table}`);
    expect(sql).toContain('UNIQUE (prompt_definition_id, revision_number)');
    expect(sql).toContain('UNIQUE (prompt_definition_id, version_label)');
    expect(sql).toContain('CREATE TRIGGER prompt_revisions_immutable');
    expect(sql).toContain('CREATE TRIGGER prompt_defaults_kind_guard');
    expect(sql).toContain('CREATE TRIGGER project_prompt_bindings_kind_guard');
  });

  it('imports every visible legacy prompt source', () => {
    expect(sql).toContain('FROM generation_system_prompts');
    expect(sql).toContain('FROM meta_prompts');
    expect(sql).toContain('FROM prompt_library');
  });

  it('enables RLS and preserves legacy tables', () => {
    expect(sql.match(/ENABLE ROW LEVEL SECURITY/g)).toHaveLength(5);
    expect(sql).not.toMatch(
      /DROP TABLE\s+(generation_system_prompts|meta_prompts|prompt_library)/i,
    );
  });
});
