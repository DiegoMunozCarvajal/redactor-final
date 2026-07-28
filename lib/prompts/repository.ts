import { db } from '@/lib/db';
import { and, eq, max } from 'drizzle-orm';
import type { ExtractTablesWithRelations } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { PgTransaction, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import * as schema from '@/lib/db/schema';
import {
  promptDefinitions,
  promptRevisions,
  promptDefaults,
  projectPromptBindings,
} from '@/lib/db/schema/prompt-registry';
import type { PromptKind } from '@/lib/db/schema/prompt-registry';
import { assertPromptMarkers, promptRevisionInputSchema } from '@/lib/prompts/contracts';
import type { z } from 'zod';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PgSchema = typeof schema;
export type DB =
  | PostgresJsDatabase<PgSchema>
  | PgTransaction<PgQueryResultHKT, PgSchema, ExtractTablesWithRelations<PgSchema>>;

export interface ResolvedPromptRevision {
  id: string;
  definitionId: string;
  kind: PromptKind;
  name: string;
  revisionNumber: number;
  versionLabel: string;
  systemTemplate: string;
  userTemplate: string;
  requiredMarkers: string[];
  outputContract: string | null;
  configuration: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

type SelectRow = {
  id: string;
  promptDefinitionId: string;
  revisionNumber: number;
  versionLabel: string;
  systemTemplate: string;
  userTemplate: string;
  requiredMarkers: string[];
  outputContract: string | null;
  configuration: Record<string, unknown>;
  kind: string;
  name: string;
  archivedAt: Date | null;
};

function rowToResolved(row: SelectRow): ResolvedPromptRevision {
  return {
    id: row.id,
    definitionId: row.promptDefinitionId,
    kind: row.kind as PromptKind,
    name: row.name,
    revisionNumber: row.revisionNumber,
    versionLabel: row.versionLabel,
    systemTemplate: row.systemTemplate,
    userTemplate: row.userTemplate,
    requiredMarkers: row.requiredMarkers,
    outputContract: row.outputContract,
    configuration: row.configuration,
  };
}

const selectFields = {
  id: promptRevisions.id,
  promptDefinitionId: promptRevisions.promptDefinitionId,
  revisionNumber: promptRevisions.revisionNumber,
  versionLabel: promptRevisions.versionLabel,
  systemTemplate: promptRevisions.systemTemplate,
  userTemplate: promptRevisions.userTemplate,
  requiredMarkers: promptRevisions.requiredMarkers,
  outputContract: promptRevisions.outputContract,
  configuration: promptRevisions.configuration,
  kind: promptDefinitions.kind,
  name: promptDefinitions.name,
  archivedAt: promptDefinitions.archivedAt,
} as const;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve the active prompt revision for a given kind.
 *
 * Resolution order:
 * 1. `runRevisionId` — direct revision lookup
 * 2. `projectId` — project-level binding via `projectPromptBindings`
 * 3. Fallback — global default via `promptDefaults`
 *
 * Validates that the resolved revision's kind matches the requested kind and
 * rejects revisions marked as `legacyNonExecutable`.
 */
export async function resolvePromptRevision(
  input: { kind: PromptKind; runRevisionId?: string; projectId?: string; revisionNumber?: number },
  ctx: DB = db,
): Promise<ResolvedPromptRevision> {
  let rows: SelectRow[];

  if (input.runRevisionId) {
    // 1. Direct revision lookup
    rows = await ctx
      .select(selectFields)
      .from(promptRevisions)
      .innerJoin(
        promptDefinitions,
        eq(promptRevisions.promptDefinitionId, promptDefinitions.id),
      )
      .where(eq(promptRevisions.id, input.runRevisionId))
      .limit(1);
  } else if (input.projectId) {
    // 2. Project-level binding
    rows = await ctx
      .select(selectFields)
      .from(projectPromptBindings)
      .innerJoin(
        promptRevisions,
        eq(projectPromptBindings.promptRevisionId, promptRevisions.id),
      )
      .innerJoin(
        promptDefinitions,
        eq(promptRevisions.promptDefinitionId, promptDefinitions.id),
      )
      .where(
        and(
          eq(projectPromptBindings.projectId, input.projectId),
          eq(projectPromptBindings.kind, input.kind),
          ...(input.revisionNumber !== undefined
            ? [eq(promptRevisions.revisionNumber, input.revisionNumber)]
            : []),
        ),
      )
      .limit(1);

    // 2b. Fallback to global default when no project binding exists
    if (rows.length === 0) {
      rows = await ctx
        .select(selectFields)
        .from(promptDefaults)
        .innerJoin(
          promptRevisions,
          eq(promptDefaults.promptRevisionId, promptRevisions.id),
        )
        .innerJoin(
          promptDefinitions,
          eq(promptRevisions.promptDefinitionId, promptDefinitions.id),
        )
        .where(
          and(
            eq(promptDefaults.kind, input.kind),
            ...(input.revisionNumber !== undefined
              ? [eq(promptRevisions.revisionNumber, input.revisionNumber)]
              : []),
          ),
        )
        .limit(1);
    }
  } else {
    // 3. Global default
    rows = await ctx
      .select(selectFields)
      .from(promptDefaults)
      .innerJoin(
        promptRevisions,
        eq(promptDefaults.promptRevisionId, promptRevisions.id),
      )
      .innerJoin(
        promptDefinitions,
        eq(promptRevisions.promptDefinitionId, promptDefinitions.id),
      )
      .where(
        and(
          eq(promptDefaults.kind, input.kind),
          ...(input.revisionNumber !== undefined
            ? [eq(promptRevisions.revisionNumber, input.revisionNumber)]
            : []),
        ),
      )
      .limit(1);
  }

  // 4. Direct lookup by kind + revisionNumber when defaults chain failed
  // promptDefaults FK join constrains to one revision — can't resolve
  // a different revisionNumber. Bypass defaults, query directly.
  if (rows.length === 0 && input.revisionNumber !== undefined) {
    rows = await ctx
      .select(selectFields)
      .from(promptRevisions)
      .innerJoin(
        promptDefinitions,
        eq(promptRevisions.promptDefinitionId, promptDefinitions.id),
      )
      .where(
        and(
          eq(promptDefinitions.kind, input.kind),
          eq(promptRevisions.revisionNumber, input.revisionNumber),
        ),
      )
      .limit(1);
  }

  if (rows.length === 0) {
    throw new Error(`No prompt revision found for kind ${input.kind}`);
  }

  const row = rows[0];

  // Validate kind matches
  if (row.kind !== input.kind) {
    throw new Error(
      `Prompt kind mismatch: requested ${input.kind}, found ${row.kind}`,
    );
  }

  // Reject legacy non-executable
  if (row.configuration?.legacyNonExecutable === true) {
    throw new Error(
      `Prompt revision ${row.id} is non-executable (legacy)`,
    );
  }

  // Reject archived definitions
  if (row.archivedAt !== null) {
    throw new Error(
      `Prompt revision ${row.id} belongs to an archived definition`,
    );
  }

  return rowToResolved(row);
}

/**
 * Create a new immutable revision for a prompt definition.
 *
 * Runs in a transaction:
 * 1. Locks the definition row (SELECT FOR UPDATE)
 * 2. Computes the next revision number (max + 1)
 * 3. Validates runtime markers via `assertPromptMarkers`
 * 4. Rejects reserved configuration keys starting with `legacy`
 * 5. Inserts the new revision and returns the resolved shape
 */
export async function createPromptRevision(
  definitionId: string,
  input: z.infer<typeof promptRevisionInputSchema>,
  userId: string,
  ctx: DB = db,
): Promise<ResolvedPromptRevision> {
  // Parse and validate input shape
  const parsed = promptRevisionInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(`Invalid prompt revision input: ${parsed.error.message}`);
  }
  const data = parsed.data;

  return ctx.transaction(async (tx) => {
    // 1. Lock the definition row
    const [def] = await tx
      .select({
        id: promptDefinitions.id,
        kind: promptDefinitions.kind,
        name: promptDefinitions.name,
        archivedAt: promptDefinitions.archivedAt,
      })
      .from(promptDefinitions)
      .where(eq(promptDefinitions.id, definitionId))
      .for('update');

    if (!def) {
      throw new Error(`Prompt definition ${definitionId} not found`);
    }

    if (def.archivedAt !== null) {
      throw new Error(`Prompt definition ${definitionId} is archived`);
    }

    // 2. Compute next revision number
    const [maxResult] = await tx
      .select({ maxRevision: max(promptRevisions.revisionNumber) })
      .from(promptRevisions)
      .where(eq(promptRevisions.promptDefinitionId, definitionId))
      .limit(1);

    const nextRevisionNumber = (maxResult?.maxRevision ?? 0) + 1;

    // 3. Validate runtime markers
    const requiredMarkers = assertPromptMarkers(
      def.kind as PromptKind,
      data.systemTemplate,
      data.userTemplate,
    );

    // 4. Reject reserved configuration keys
    const config = data.configuration ?? {};
    for (const key of Object.keys(config)) {
      if (key.startsWith('legacy')) {
        throw new Error(`Reserved configuration key: ${key}`);
      }
    }

    // 5. Insert new revision
    const [revision] = await tx
      .insert(promptRevisions)
      .values({
        promptDefinitionId: definitionId,
        revisionNumber: nextRevisionNumber,
        versionLabel: data.versionLabel,
        systemTemplate: data.systemTemplate,
        userTemplate: data.userTemplate,
        requiredMarkers,
        outputContract: data.outputContract ?? null,
        configuration: config as Record<string, unknown>,
        createdBy: userId,
      })
      .returning();

    return {
      id: revision.id,
      definitionId: revision.promptDefinitionId,
      kind: def.kind as PromptKind,
      name: def.name,
      revisionNumber: revision.revisionNumber,
      versionLabel: revision.versionLabel,
      systemTemplate: revision.systemTemplate,
      userTemplate: revision.userTemplate,
      requiredMarkers: revision.requiredMarkers,
      outputContract: revision.outputContract,
      configuration: revision.configuration as Record<string, unknown>,
    };
  });
}
