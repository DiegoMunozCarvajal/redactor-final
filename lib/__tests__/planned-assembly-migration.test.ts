import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  new URL(
    '../../supabase/migrations/20260714000003_add_planned_editorial_assembly.sql',
    import.meta.url,
  ),
  'utf8',
);

describe('planned editorial assembly migration', () => {
  it('adds planning state and immutable prompt references', () => {
    expect(sql).toContain("ADD VALUE IF NOT EXISTS 'planning'");
    for (const column of [
      'assembly_plan',
      'planning_metadata',
      'planner_prompt_revision_id',
      'assembly_prompt_revision_id',
    ])
      expect(sql).toContain(column);
  });

  it('seeds planner v1 and assembly v1.3 as defaults', () => {
    expect(sql).toContain('Assembly Planner');
    expect(sql).toContain("'1.0'");
    expect(sql).toContain('Assembly Prompt');
    expect(sql).toContain("'1.3'");
    expect(sql).toContain("'assembly-planner'");
    expect(sql).toContain("'assembly'");
  });

  it('contains no numeric illustration quota', () => {
    expect(sql).not.toMatch(/(?:máximo|exactamente|solo)\s+[1234]\s+(?:ejempl|analog|caso)/i);
  });
});
