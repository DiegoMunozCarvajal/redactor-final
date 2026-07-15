import { db as globalDb } from "@/lib/db";
import { and, eq, count, isNull, isNotNull, inArray, desc } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { PgTransaction, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import {
  promptDefinitions,
  promptRevisions,
  promptDefaults,
  projectPromptBindings,
  llmPromptExecutions,
} from "@/lib/db/schema/prompt-registry";
import type { PromptKind } from "@/lib/db/schema/prompt-registry";
import type {
  DefinitionSummary,
  DefinitionDetail,
  RevisionDetail,
  ArchiveConflictError,
} from "./admin-types";

type PgSchema = typeof schema;
export type DB =
  | PostgresJsDatabase<PgSchema>
  | PgTransaction<PgQueryResultHKT, PgSchema, ExtractTablesWithRelations<PgSchema>>;

// ---------------------------------------------------------------------------
// listPromptDefinitionSummaries
// ---------------------------------------------------------------------------

export async function listPromptDefinitionSummaries(
  opts: {
    kind?: string;
    archive?: "active" | "archived" | "all";
  },
  ctx: DB = globalDb,
): Promise<DefinitionSummary[]> {
  const archive = opts.archive ?? "active";

  const conditions = [];
  if (opts.kind) conditions.push(eq(promptDefinitions.kind, opts.kind as PromptKind));
  if (archive === "active") conditions.push(isNull(promptDefinitions.archivedAt));
  else if (archive === "archived") conditions.push(isNotNull(promptDefinitions.archivedAt));

  const defs = await ctx
    .select({
      id: promptDefinitions.id,
      name: promptDefinitions.name,
      description: promptDefinitions.description,
      kind: promptDefinitions.kind,
      archivedAt: promptDefinitions.archivedAt,
    })
    .from(promptDefinitions)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(promptDefinitions.name);

  const defIds = defs.map((d) => d.id);

  // Fetch all revisions for these definitions, pick latest in JS (small N — admin panel)
  const allRevs =
    defIds.length > 0
      ? await ctx
          .select({
            promptDefinitionId: promptRevisions.promptDefinitionId,
            id: promptRevisions.id,
            versionLabel: promptRevisions.versionLabel,
            revisionNumber: promptRevisions.revisionNumber,
          })
          .from(promptRevisions)
          .where(inArray(promptRevisions.promptDefinitionId, defIds))
          .orderBy(desc(promptRevisions.revisionNumber))
      : [];
  const latestMap = new Map<string, (typeof allRevs)[number]>();
  for (const r of allRevs) {
    if (!latestMap.has(r.promptDefinitionId)) latestMap.set(r.promptDefinitionId, r);
  }

  // Batch: defaults (per-kind)
  const defKinds = [...new Set(defs.map((d) => d.kind))];
  const defaultRows =
    defKinds.length > 0
      ? await ctx
          .select({
            kind: promptDefaults.kind,
            promptRevisionId: promptDefaults.promptRevisionId,
          })
          .from(promptDefaults)
          .where(inArray(promptDefaults.kind, defKinds))
      : [];
  // Resolve which definitions have the global default for their kind
  // allRevs already has every revision for these definitions
  const revIdToDefId = new Map(allRevs.map((r) => [r.id, r.promptDefinitionId]));
  const defaultForDef = new Map<string, string>(); // definitionId -> defaultRevisionId
  for (const dRow of defaultRows) {
    const defId = revIdToDefId.get(dRow.promptRevisionId);
    if (defId) defaultForDef.set(defId, dRow.promptRevisionId);
  }

  // Batch: default version labels
  const defaultRevIds = [...new Set(defaultRows.map((r) => r.promptRevisionId))];
  const defaultLabels =
    defaultRevIds.length > 0
      ? await ctx
          .select({ id: promptRevisions.id, versionLabel: promptRevisions.versionLabel })
          .from(promptRevisions)
          .where(inArray(promptRevisions.id, defaultRevIds))
      : [];
  const defaultLabelMap = new Map(defaultLabels.map((d) => [d.id, d.versionLabel]));

  // Batch: binding counts
  const bindingCounts =
    defIds.length > 0
      ? await ctx
          .select({
            definitionId: promptRevisions.promptDefinitionId,
            cnt: count(),
          })
          .from(projectPromptBindings)
          .innerJoin(
            promptRevisions,
            eq(projectPromptBindings.promptRevisionId, promptRevisions.id),
          )
          .where(inArray(promptRevisions.promptDefinitionId, defIds))
          .groupBy(promptRevisions.promptDefinitionId)
      : [];
  const bindingMap = new Map(bindingCounts.map((b) => [b.definitionId, Number(b.cnt)]));

  // Batch: execution counts
  const execCounts =
    defIds.length > 0
      ? await ctx
          .select({
            definitionId: promptRevisions.promptDefinitionId,
            cnt: count(),
          })
          .from(llmPromptExecutions)
          .innerJoin(
            promptRevisions,
            eq(llmPromptExecutions.promptRevisionId, promptRevisions.id),
          )
          .where(inArray(promptRevisions.promptDefinitionId, defIds))
          .groupBy(promptRevisions.promptDefinitionId)
      : [];
  const execMap = new Map(execCounts.map((e) => [e.definitionId, Number(e.cnt)]));

  const result: DefinitionSummary[] = defs.map((d) => {
    const latest = latestMap.get(d.id);
    const defRevId = defaultForDef.get(d.id) ?? null;
    return {
      id: d.id,
      name: d.name,
      description: d.description,
      kind: d.kind as PromptKind,
      archivedAt: d.archivedAt?.toISOString() ?? null,
      latestRevision: latest
        ? {
            id: latest.id,
            versionLabel: latest.versionLabel,
            revisionNumber: latest.revisionNumber,
          }
        : null,
      defaultRevisionId: defRevId,
      defaultVersionLabel: defRevId ? (defaultLabelMap.get(defRevId) ?? null) : null,
      bindingCount: bindingMap.get(d.id) ?? 0,
      executionCount: execMap.get(d.id) ?? 0,
    };
  });

  return result;
}

// ---------------------------------------------------------------------------
// getPromptDefinitionDetail
// ---------------------------------------------------------------------------

export async function getPromptDefinitionDetail(
  definitionId: string,
  defaultRevisionId?: string | null,
  ctx: DB = globalDb,
): Promise<DefinitionDetail> {
  const [def] = await ctx
    .select()
    .from(promptDefinitions)
    .where(eq(promptDefinitions.id, definitionId))
    .limit(1);
  if (!def) throw new Error(`Prompt definition ${definitionId} not found`);

  const revisions = await ctx
    .select()
    .from(promptRevisions)
    .where(eq(promptRevisions.promptDefinitionId, definitionId))
    .orderBy(desc(promptRevisions.revisionNumber));

  const revIds = revisions.map((r) => r.id);

  // Default resolution: passed in, or fetch from prompt_defaults
  let effectiveDefaultId = defaultRevisionId ?? null;
  if (!effectiveDefaultId) {
    const [defaultRow] = await ctx
      .select({ promptRevisionId: promptDefaults.promptRevisionId })
      .from(promptDefaults)
      .where(eq(promptDefaults.kind, def.kind))
      .limit(1);
    effectiveDefaultId = defaultRow?.promptRevisionId ?? null;
  }

  // Batch binding/execution counts per revision
  const bindingCounts =
    revIds.length > 0
      ? await ctx
          .select({ revisionId: projectPromptBindings.promptRevisionId, cnt: count() })
          .from(projectPromptBindings)
          .where(inArray(projectPromptBindings.promptRevisionId, revIds))
          .groupBy(projectPromptBindings.promptRevisionId)
      : [];
  const bindingMap = new Map(bindingCounts.map((b) => [b.revisionId, Number(b.cnt)]));

  const execCounts =
    revIds.length > 0
      ? await ctx
          .select({ revisionId: llmPromptExecutions.promptRevisionId, cnt: count() })
          .from(llmPromptExecutions)
          .where(inArray(llmPromptExecutions.promptRevisionId, revIds))
          .groupBy(llmPromptExecutions.promptRevisionId)
      : [];
  const execMap = new Map(execCounts.map((e) => [e.revisionId, Number(e.cnt)]));

  const revisionDetails: RevisionDetail[] = revisions.map((r) => ({
    id: r.id,
    revisionNumber: r.revisionNumber,
    versionLabel: r.versionLabel,
    systemTemplate: r.systemTemplate,
    userTemplate: r.userTemplate,
    requiredMarkers: r.requiredMarkers,
    outputContract: r.outputContract,
    configuration: r.configuration as Record<string, unknown>,
    createdAt: r.createdAt?.toISOString() ?? "",
    createdBy: r.createdBy,
    isDefault: r.id === effectiveDefaultId,
    bindingCount: bindingMap.get(r.id) ?? 0,
    executionCount: execMap.get(r.id) ?? 0,
  }));

  return {
    id: def.id,
    name: def.name,
    description: def.description,
    kind: def.kind as PromptKind,
    archivedAt: def.archivedAt?.toISOString() ?? null,
    revisions: revisionDetails,
    defaultRevisionId: effectiveDefaultId,
    totalBindingCount: revisionDetails.reduce((s, r) => s + r.bindingCount, 0),
    totalExecutionCount: revisionDetails.reduce((s, r) => s + r.executionCount, 0),
  };
}

// ---------------------------------------------------------------------------
// Archive / restore
// ---------------------------------------------------------------------------

export async function getArchiveBlockers(
  definitionId: string,
  ctx: DB = globalDb,
): Promise<ArchiveConflictError> {
  const [def] = await ctx
    .select({ kind: promptDefinitions.kind })
    .from(promptDefinitions)
    .where(eq(promptDefinitions.id, definitionId))
    .limit(1);
  if (!def) throw new Error("Definition not found");

  const revisionIds = (
    await ctx
      .select({ id: promptRevisions.id })
      .from(promptRevisions)
      .where(eq(promptRevisions.promptDefinitionId, definitionId))
  ).map((r) => r.id);

  if (revisionIds.length === 0) {
    return { defaultCount: 0, bindingCount: 0 };
  }

  const [defaultRow] = await ctx
    .select({ cnt: count() })
    .from(promptDefaults)
    .where(
      and(
        eq(promptDefaults.kind, def.kind),
        inArray(promptDefaults.promptRevisionId, revisionIds),
      ),
    );
  const defaultCount = Number(defaultRow?.cnt ?? 0);

  const [bindingRow] = await ctx
    .select({ cnt: count() })
    .from(projectPromptBindings)
    .where(inArray(projectPromptBindings.promptRevisionId, revisionIds));
  const bindingCount = Number(bindingRow?.cnt ?? 0);

  return { defaultCount, bindingCount };
}

export async function setPromptDefinitionArchived(
  definitionId: string,
  archived: boolean,
  ctx: DB = globalDb,
): Promise<void> {
  if (archived) {
    const blockers = await getArchiveBlockers(definitionId, ctx);
    if (blockers.defaultCount > 0 || blockers.bindingCount > 0) {
      throw new Error(
        `Cannot archive: ${blockers.defaultCount} defaults, ${blockers.bindingCount} bindings`,
      );
    }
  }

  await ctx
    .update(promptDefinitions)
    .set({ archivedAt: archived ? new Date() : null })
    .where(eq(promptDefinitions.id, definitionId));
}
