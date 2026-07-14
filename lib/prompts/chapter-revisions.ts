import { prompts, promptVersions } from "@/lib/db/schema";
import type { Prompt, ChapterPromptSnapshot } from "@/lib/db/schema";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { PgTransaction, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { eq, max } from "drizzle-orm";

type PgSchema = typeof schema;
type DB =
  | PostgresJsDatabase<PgSchema>
  | PgTransaction<PgQueryResultHKT, PgSchema, ExtractTablesWithRelations<PgSchema>>;

/**
 * Capture all 10 content fields of a Prompt row into an immutable snapshot.
 * Always marks legacyIncomplete as false -- only pre-P3-T2 snapshots
 * (created without full field coverage) carry the legacy flag.
 */
export function snapshotChapterPrompt(row: Prompt): ChapterPromptSnapshot {
  return {
    title: row.title,
    content: row.content,
    userPrompt: row.userPrompt ?? null,
    position: row.position,
    isAssembly: row.isAssembly ?? false,
    isCritique: row.isCritique ?? false,
    isCorrector: row.isCorrector ?? false,
    function: row.function ?? null,
    notes: row.notes ?? null,
    sourceContext: row.sourceContext ?? null,
    legacyIncomplete: false,
  };
}

/**
 * Capture the current state of a prompt as a new immutable revision.
 *
 * 1. Loads the current prompt row
 * 2. Computes the next revision number (max + 1)
 * 3. Inserts a new prompt_versions row with the full snapshot
 * 4. Sets prompts.current_revision_id to the new version
 *
 * All operations use the provided DB context (which may be a transaction).
 * Returns the new version ID.
 */
export async function writeCurrentChapterPromptRevision(
  promptId: string,
  userId: string,
  ctx: DB,
): Promise<string> {
  const [prompt] = await ctx
    .select()
    .from(prompts)
    .where(eq(prompts.id, promptId))
    .limit(1);
  if (!prompt) throw new Error(`Prompt ${promptId} not found`);

  const [maxResult] = await ctx
    .select({ maxRevision: max(promptVersions.revisionNumber) })
    .from(promptVersions)
    .where(eq(promptVersions.promptId, promptId))
    .limit(1);
  const nextRevision = (maxResult?.maxRevision ?? 0) + 1;

  const snapshot = snapshotChapterPrompt(prompt);

  const [version] = await ctx
    .insert(promptVersions)
    .values({
      promptId,
      revisionNumber: nextRevision,
      title: prompt.title,
      content: prompt.content,
      userPrompt: prompt.userPrompt,
      snapshot,
      createdBy: userId,
    })
    .returning();

  await ctx
    .update(prompts)
    .set({ currentRevisionId: version.id })
    .where(eq(prompts.id, promptId));

  return version.id;
}

/**
 * Validate that a snapshot has at most one exclusive role flag set.
 * Throws if more than one of isAssembly, isCritique, isCorrector is true.
 */
export function assertExclusiveRoles(snapshot: ChapterPromptSnapshot): void {
  const roles: string[] = [];
  if (snapshot.isAssembly) roles.push("assembly");
  if (snapshot.isCritique) roles.push("critique");
  if (snapshot.isCorrector) roles.push("corrector");
  if (roles.length > 1) {
    throw new Error(
      `Prompt cannot have more than one exclusive role (assembly, critique, corrector): got ${roles.join(", ")}`,
    );
  }
}
