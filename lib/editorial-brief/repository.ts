import { db } from "@/lib/db/drizzle";
import { and, eq, sql, max, desc } from "drizzle-orm";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { PgTransaction } from "drizzle-orm/pg-core";
import * as schema from "@/lib/db/schema";
import {
  editorialBriefs,
  chapterEditorialContracts,
  editorialBriefSources,
} from "@/lib/db/schema/editorial-briefs";
import { chapters } from "@/lib/db/schema/chapters";
import { sources } from "@/lib/db/schema/sources";
import { canonicalStringify, hashEditorialBundle } from "@/lib/editorial-brief/hash";
import { editorialBriefBundleInputSchema } from "@/lib/editorial-brief/schema";
import type {
  EditorialBriefContent,
  ChapterEditorialContract,
  EditorialBundle,
} from "@/lib/editorial-brief/schema";
import { createHash } from "crypto";

// ---------------------------------------------------------------------------
// Db context type — allows callers to inject a transaction or test db instance
// ---------------------------------------------------------------------------

type PgSchema = typeof schema;
type DB = PostgresJsDatabase<PgSchema> | PgTransaction<any, PgSchema, ExtractTablesWithRelations<PgSchema>>;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function hashContract(contract: ChapterEditorialContract): string {
  return createHash("sha256")
    .update(canonicalStringify(contract), "utf-8")
    .digest("hex");
}

/** Validate that all chapterIds belong to the given project. */
async function validateChaptersBelongToProject(
  chapterIds: string[],
  projectId: string,
  ctx: DB,
): Promise<void> {
  if (chapterIds.length === 0) return;
  const matching = await ctx
    .select({ id: chapters.id })
    .from(chapters)
    .where(and(eq(chapters.projectId, projectId), sql`${chapters.id} = ANY(ARRAY[${sql.join(chapterIds.map((id) => sql`${id}::uuid`), sql`, `)}]::uuid[])`));

  if (matching.length !== chapterIds.length) {
    throw new Error("One or more chapters do not belong to this project");
  }
}

/** Validate that all sourceIds belong to the given project. */
async function validateSourcesBelongToProject(
  sourceIds: string[],
  projectId: string,
  ctx: DB,
): Promise<void> {
  if (sourceIds.length === 0) return;
  const matching = await ctx
    .select({ id: sources.id })
    .from(sources)
    .where(and(eq(sources.projectId, projectId), sql`${sources.id} = ANY(ARRAY[${sql.join(sourceIds.map((id) => sql`${id}::uuid`), sql`, `)}]::uuid[])`));

  if (matching.length !== sourceIds.length) {
    throw new Error("One or more sources do not belong to this project");
  }
}

/**
 * Enrich a raw brief row into an EditorialBundle.
 *
 * NOTE: Zod validation of stored JSON content is deferred (no `.parse()` on read).
 * Content was already validated by `editorialBriefBundleInputSchema` before
 * insertion, so re-validating on every read would add unnecessary overhead.
 * The `as unknown as` casts are safe given the validated-write invariant.
 */
async function enrichToBundle(
  brief: typeof editorialBriefs.$inferSelect,
  ctx: DB,
): Promise<EditorialBundle> {
  const contracts = await ctx
    .select()
    .from(chapterEditorialContracts)
    .where(eq(chapterEditorialContracts.editorialBriefId, brief.id));

  const briefSources = await ctx
    .select()
    .from(editorialBriefSources)
    .where(eq(editorialBriefSources.editorialBriefId, brief.id));

  // Verify per-contract hashes against stored content. This detects data
  // corruption or stale rows from prior buggy writes.
  for (const c of contracts) {
    const contract = c.content as unknown as ChapterEditorialContract;
    const computed = hashContract(contract);
    if (computed !== c.contentHash) {
      throw new Error(
        `Contract content hash mismatch for chapter ${c.chapterId} in brief ${brief.id}`,
      );
    }
  }

  return {
    id: brief.id,
    version: brief.version,
    hash: brief.contentHash,
    content: brief.content as unknown as EditorialBriefContent,
    contracts: contracts.map(
      (c) => c.content as unknown as ChapterEditorialContract,
    ),
    evidenceSourceIds: briefSources.map((s) => s.sourceId),
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create a new editorial brief draft for a project.
 * Allocates the next version number and validates chapter/source ownership.
 */
export async function createEditorialBriefDraft(
  input: {
    projectId: string;
    content: EditorialBriefContent;
    contracts: ChapterEditorialContract[];
    evidenceSourceIds: string[];
  },
  ctx?: DB,
): Promise<EditorialBundle> {
  const dbCtx = ctx ?? db;

  // Validate input shape
  const parsed = editorialBriefBundleInputSchema.safeParse({
    content: input.content,
    contracts: input.contracts,
    evidenceSourceIds: input.evidenceSourceIds,
  });
  if (!parsed.success) {
    throw new Error(`Invalid bundle input: ${parsed.error.message}`);
  }

  // Validate cross-project references
  const chapterIds = input.contracts.map((c) => c.chapterId);
  await validateChaptersBelongToProject(chapterIds, input.projectId, dbCtx);
  await validateSourcesBelongToProject(input.evidenceSourceIds, input.projectId, dbCtx);

  // Compute hash
  const bundleForHash: EditorialBundle = {
    id: "", // placeholder — not included in hash
    version: 0, // placeholder — not included in hash
    hash: "",
    content: input.content,
    contracts: input.contracts,
    evidenceSourceIds: input.evidenceSourceIds,
  };
  const contentHash = hashEditorialBundle(bundleForHash);

  // Allocate version and insert inside a transaction
  return dbCtx.transaction(async (tx) => {
    // Lock the project's briefs to serialize version allocation.
    // When creating the first draft, no rows match the WHERE clause so no
    // rows are locked. This is fine because the UNIQUE (project_id, version)
    // constraint acts as the fallback guard against version conflicts.
    const existing = await tx
      .select({ maxVersion: max(editorialBriefs.version) })
      .from(editorialBriefs)
      .where(eq(editorialBriefs.projectId, input.projectId))
      .for("update");

    const latestVersion = existing[0]?.maxVersion ?? 0;
    const nextVersion = latestVersion + 1;

    const [brief] = await tx
      .insert(editorialBriefs)
      .values({
        projectId: input.projectId,
        version: nextVersion,
        status: "draft",
        content: input.content as unknown as Record<string, unknown>,
        contentHash,
      })
      .returning();

    // Insert contracts
    if (input.contracts.length > 0) {
      await tx.insert(chapterEditorialContracts).values(
        input.contracts.map((contract) => ({
          editorialBriefId: brief.id,
          chapterId: contract.chapterId,
          content: contract as unknown as Record<string, unknown>,
          contentHash: hashContract(contract),
        })),
      );
    }

    // Insert source bindings
    if (input.evidenceSourceIds.length > 0) {
      await tx.insert(editorialBriefSources).values(
        input.evidenceSourceIds.map((sourceId) => ({
          editorialBriefId: brief.id,
          sourceId,
        })),
      );
    }

    return enrichToBundle(brief, tx);
  });
}

/**
 * Replace an existing draft bundle atomically (content, contracts, sources, hash).
 */
export async function replaceEditorialBriefDraft(
  input: {
    briefId: string;
    projectId: string;
    content: EditorialBriefContent;
    contracts: ChapterEditorialContract[];
    evidenceSourceIds: string[];
  },
  ctx?: DB,
): Promise<EditorialBundle> {
  const dbCtx = ctx ?? db;

  // Validate input shape
  const parsed = editorialBriefBundleInputSchema.safeParse({
    content: input.content,
    contracts: input.contracts,
    evidenceSourceIds: input.evidenceSourceIds,
  });
  if (!parsed.success) {
    throw new Error(`Invalid bundle input: ${parsed.error.message}`);
  }

  const chapterIds = input.contracts.map((c) => c.chapterId);
  await validateChaptersBelongToProject(chapterIds, input.projectId, dbCtx);
  await validateSourcesBelongToProject(input.evidenceSourceIds, input.projectId, dbCtx);

  const bundleForHash: EditorialBundle = {
    id: "",
    version: 0,
    hash: "",
    content: input.content,
    contracts: input.contracts,
    evidenceSourceIds: input.evidenceSourceIds,
  };
  const contentHash = hashEditorialBundle(bundleForHash);

  return dbCtx.transaction(async (tx) => {
    // Load existing brief and verify it's a draft for this project
    const [existing] = await tx
      .select()
      .from(editorialBriefs)
      .where(
        and(
          eq(editorialBriefs.id, input.briefId),
          eq(editorialBriefs.projectId, input.projectId),
        ),
      )
      .for("update");

    if (!existing) {
      throw new Error("Editorial brief not found");
    }
    if (existing.status !== "draft") {
      throw new Error("Cannot replace a non-draft editorial brief");
    }

    // Remove old contracts and sources
    await tx
      .delete(chapterEditorialContracts)
      .where(eq(chapterEditorialContracts.editorialBriefId, input.briefId));

    await tx
      .delete(editorialBriefSources)
      .where(eq(editorialBriefSources.editorialBriefId, input.briefId));

    // Insert new contracts
    if (input.contracts.length > 0) {
      await tx.insert(chapterEditorialContracts).values(
        input.contracts.map((contract) => ({
          editorialBriefId: input.briefId,
          chapterId: contract.chapterId,
          content: contract as unknown as Record<string, unknown>,
          contentHash: hashContract(contract),
        })),
      );
    }

    // Insert new source bindings
    if (input.evidenceSourceIds.length > 0) {
      await tx.insert(editorialBriefSources).values(
        input.evidenceSourceIds.map((sourceId) => ({
          editorialBriefId: input.briefId,
          sourceId,
        })),
      );
    }

    // Update the brief
    const [updated] = await tx
      .update(editorialBriefs)
      .set({
        content: input.content as unknown as Record<string, unknown>,
        contentHash,
        updatedAt: sql`now()`,
      })
      .where(eq(editorialBriefs.id, input.briefId))
      .returning();

    return enrichToBundle(updated, tx);
  });
}

/**
 * Delete a draft editorial brief. Only drafts can be deleted.
 */
export async function deleteEditorialBriefDraft(
  input: {
    briefId: string;
    projectId: string;
  },
  ctx?: DB,
): Promise<void> {
  const dbCtx = ctx ?? db;

  await dbCtx.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(editorialBriefs)
      .where(
        and(
          eq(editorialBriefs.id, input.briefId),
          eq(editorialBriefs.projectId, input.projectId),
        ),
      )
      .for("update");

    if (!existing) {
      throw new Error("Editorial brief not found");
    }
    if (existing.status !== "draft") {
      throw new Error("Cannot delete a non-draft editorial brief");
    }

    await tx
      .delete(editorialBriefs)
      .where(eq(editorialBriefs.id, input.briefId));
  });
}

/**
 * Approve a draft brief. Archives the currently approved version atomically.
 */
export async function approveEditorialBrief(
  input: {
    briefId: string;
    projectId: string;
  },
  ctx?: DB,
): Promise<EditorialBundle> {
  const dbCtx = ctx ?? db;

  return dbCtx.transaction(async (tx) => {
    // Load the draft
    const [draft] = await tx
      .select()
      .from(editorialBriefs)
      .where(
        and(
          eq(editorialBriefs.id, input.briefId),
          eq(editorialBriefs.projectId, input.projectId),
          eq(editorialBriefs.status, "draft"),
        ),
      )
      .for("update");

    if (!draft) {
      throw new Error("Draft editorial brief not found");
    }

    // Archive any currently approved version
    await tx
      .update(editorialBriefs)
      .set({ status: "archived", updatedAt: sql`now()` })
      .where(
        and(
          eq(editorialBriefs.projectId, input.projectId),
          eq(editorialBriefs.status, "approved"),
        ),
      );

    // Approve the draft
    const [approved] = await tx
      .update(editorialBriefs)
      .set({
        status: "approved",
        approvedAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(eq(editorialBriefs.id, input.briefId))
      .returning();

    return enrichToBundle(approved, tx);
  });
}

/**
 * Load an editorial brief bundle by id, verifying project and optional hash.
 */
export async function getEditorialBriefBundle(
  input: {
    projectId: string;
    briefId: string;
    expectedHash?: string;
  },
  ctx?: DB,
): Promise<EditorialBundle | null> {
  const dbCtx = ctx ?? db;

  const [brief] = await dbCtx
    .select()
    .from(editorialBriefs)
    .where(
      and(
        eq(editorialBriefs.id, input.briefId),
        eq(editorialBriefs.projectId, input.projectId),
      ),
    );

  if (!brief) return null;

  if (input.expectedHash && brief.contentHash !== input.expectedHash) {
    throw new Error("Editorial brief hash mismatch");
  }

  return enrichToBundle(brief, dbCtx);
}

/**
 * Load the currently approved editorial brief for a project, or null.
 */
export async function getApprovedEditorialBriefBundle(
  projectId: string,
  ctx?: DB,
): Promise<EditorialBundle | null> {
  const dbCtx = ctx ?? db;

  const [brief] = await dbCtx
    .select()
    .from(editorialBriefs)
    .where(
      and(
        eq(editorialBriefs.projectId, projectId),
        eq(editorialBriefs.status, "approved"),
      ),
    );

  if (!brief) return null;

  return enrichToBundle(brief, dbCtx);
}

/**
 * Load version history for a project.
 */
export async function getEditorialBriefHistory(
  projectId: string,
  ctx?: DB,
): Promise<
  Array<{
    id: string;
    version: number;
    status: "draft" | "approved" | "archived";
    contentHash: string;
    approvedAt: string | null;
    createdAt: string;
  }>
> {
  const dbCtx = ctx ?? db;

  const rows = await dbCtx
    .select({
      id: editorialBriefs.id,
      version: editorialBriefs.version,
      status: editorialBriefs.status,
      contentHash: editorialBriefs.contentHash,
      approvedAt: editorialBriefs.approvedAt,
      createdAt: editorialBriefs.createdAt,
    })
    .from(editorialBriefs)
    .where(eq(editorialBriefs.projectId, projectId))
    .orderBy(desc(editorialBriefs.version));

  return rows.map((r) => ({
    id: r.id,
    version: r.version,
    status: r.status as "draft" | "approved" | "archived",
    contentHash: r.contentHash,
    approvedAt: r.approvedAt ? r.approvedAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
  }));
}
