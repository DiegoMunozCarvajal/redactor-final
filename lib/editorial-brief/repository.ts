import { db } from "@/lib/db/drizzle";
import { and, eq, sql, max, desc } from "drizzle-orm";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { PgTransaction, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "@/lib/db/schema";
import {
  editorialBriefs,
  chapterEditorialContracts,
  editorialBriefSources,
} from "@/lib/db/schema/editorial-briefs";
import { chapters } from "@/lib/db/schema/chapters";
import { sources } from "@/lib/db/schema/sources";
import { hashEditorialBundle } from "@/lib/editorial-brief/hash";
import {
  assertExpectedEditorialBriefHash,
  hashEditorialContract,
  verifyStoredEditorialBundle,
} from "@/lib/editorial-brief/integrity";
import {
  editorialBriefBundleInputSchema,
} from "@/lib/editorial-brief/schema";
import {
  assertExactChapterCoverage,
} from "@/lib/editorial-brief/coverage";
import type {
  EditorialBriefContent,
  ChapterEditorialContract,
  EditorialBundle,
} from "@/lib/editorial-brief/schema";

// ---------------------------------------------------------------------------
// Db context type — allows callers to inject a transaction or test db instance
// ---------------------------------------------------------------------------

type PgSchema = typeof schema;
export type DB = PostgresJsDatabase<PgSchema> | PgTransaction<PgQueryResultHKT, PgSchema, ExtractTablesWithRelations<PgSchema>>;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

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
 * Lock the project row and load current chapter IDs.
 *
 * Locking the project row serializes editorial brief operations at the project
 * level. Loading chapter IDs after the lock gives us a consistent snapshot
 * for coverage validation — no TOCTOU between chapter CRUD and brief save.
 *
 * Must be called inside a transaction before any editorial brief table access.
 */
async function lockProjectAndLoadChapterIds(
  projectId: string,
  tx: DB,
): Promise<string[]> {
  // Lock the project row — blocks concurrent brief creation/approval
  const projectRows = await tx
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .for("update");

  if (projectRows.length === 0) {
    throw new Error("Project not found");
  }

  // Load current chapter IDs under the same lock for consistent coverage
  const chapterRows = await tx
    .select({ id: chapters.id })
    .from(chapters)
    .where(eq(chapters.projectId, projectId));

  return chapterRows.map((ch) => ch.id);
}

/**
 * Enrich a raw brief row into an EditorialBundle.
 *
 * Validates stored JSONB contracts and content against the current Zod schemas.
 * Hash verification catches bit-level corruption; Zod parsing catches schema
 * drift (e.g. a new required field added after the brief was stored).
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

  return verifyStoredEditorialBundle({
    brief: {
      id: brief.id,
      version: brief.version,
      content: brief.content,
      contentHash: brief.contentHash,
    },
    contracts: contracts.map((contract) => ({
      chapterId: contract.chapterId,
      content: contract.content,
      contentHash: contract.contentHash,
    })),
    evidenceSourceIds: briefSources.map((source) => source.sourceId),
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create a new editorial brief draft for a project.
 * Allocates the next version number and validates chapter/source ownership.
 *
 * Version allocation is serialized via a project-row FOR UPDATE lock.
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
  const normalized = parsed.data;

  // Compute hash once — unchanged across retries
  const bundleForHash: EditorialBundle = {
    id: "",
    version: 0,
    hash: "",
    content: normalized.content,
    contracts: normalized.contracts,
    evidenceSourceIds: normalized.evidenceSourceIds,
  };
  const contentHash = hashEditorialBundle(bundleForHash);

  // Allocate version and insert inside a transaction.  Locking the project
  // row serializes concurrent draft creation so version allocation is safe.
  return dbCtx.transaction(async (tx) => {
    // Lock the project row first — serializes brief creation across concurrent calls
    const currentChapterIds = await lockProjectAndLoadChapterIds(input.projectId, tx);

    // Validate cross-project references inside the transaction
    const chapterIds = normalized.contracts.map((c) => c.chapterId);
    await Promise.all([
      validateChaptersBelongToProject(chapterIds, input.projectId, tx),
      validateSourcesBelongToProject(
        normalized.evidenceSourceIds,
        input.projectId,
        tx,
      ),
    ]);

    // Validate exact chapter coverage on create — every project chapter needs a contract
    assertExactChapterCoverage(chapterIds, currentChapterIds);

    // Check for existing draft BEFORE inserting. The partial unique
    // index uq_editorial_briefs_project_draft enforces at most one draft per
    // project — we surface a clear error instead of hitting the constraint.
    const [existingDraft] = await tx
      .select({ id: editorialBriefs.id })
      .from(editorialBriefs)
      .where(
        and(
          eq(editorialBriefs.projectId, input.projectId),
          eq(editorialBriefs.status, "draft"),
        ),
      );
    if (existingDraft) {
      throw new Error("A draft editorial brief already exists for this project");
    }

    // Compute next version — safe under the project lock
    const existing = await tx
      .select({ maxVersion: max(editorialBriefs.version) })
      .from(editorialBriefs)
      .where(eq(editorialBriefs.projectId, input.projectId));

    const latestVersion = existing[0]?.maxVersion ?? 0;
    const nextVersion = latestVersion + 1;

    const [brief] = await tx
      .insert(editorialBriefs)
      .values({
        projectId: input.projectId,
        version: nextVersion,
        status: "draft",
        content: normalized.content as unknown as Record<string, unknown>,
        contentHash,
      })
      .returning();

    // Insert contracts
    if (normalized.contracts.length > 0) {
      await tx.insert(chapterEditorialContracts).values(
        normalized.contracts.map((contract) => ({
          editorialBriefId: brief.id,
          chapterId: contract.chapterId,
          content: contract as unknown as Record<string, unknown>,
          contentHash: hashEditorialContract(contract),
        })),
      );
    }

    // Insert source bindings
    if (normalized.evidenceSourceIds.length > 0) {
      await tx.insert(editorialBriefSources).values(
        normalized.evidenceSourceIds.map((sourceId) => ({
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
  const normalized = parsed.data;

  const bundleForHash: EditorialBundle = {
    id: "",
    version: 0,
    hash: "",
    content: normalized.content,
    contracts: normalized.contracts,
    evidenceSourceIds: normalized.evidenceSourceIds,
  };
  const contentHash = hashEditorialBundle(bundleForHash);

  return dbCtx.transaction(async (tx) => {
    // Lock the project row first — serializes brief operations and loads
    // current chapter IDs for coverage validation on save.
    const currentChapterIds = await lockProjectAndLoadChapterIds(input.projectId, tx);

    // Validate cross-project references inside the transaction to prevent
    // TOCTOU (chapter/source reassignment between validation and delete+insert).
    const chapterIds = normalized.contracts.map((c) => c.chapterId);
    await Promise.all([
      validateChaptersBelongToProject(chapterIds, input.projectId, tx),
      validateSourcesBelongToProject(
        normalized.evidenceSourceIds,
        input.projectId,
        tx,
      ),
    ]);

    // Validate exact chapter coverage on save — prevents incomplete drafts
    assertExactChapterCoverage(chapterIds, currentChapterIds);

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
    if (normalized.contracts.length > 0) {
      await tx.insert(chapterEditorialContracts).values(
        normalized.contracts.map((contract) => ({
          editorialBriefId: input.briefId,
          chapterId: contract.chapterId,
          content: contract as unknown as Record<string, unknown>,
          contentHash: hashEditorialContract(contract),
        })),
      );
    }

    // Insert new source bindings
    if (normalized.evidenceSourceIds.length > 0) {
      await tx.insert(editorialBriefSources).values(
        normalized.evidenceSourceIds.map((sourceId) => ({
          editorialBriefId: input.briefId,
          sourceId,
        })),
      );
    }

    // Update the brief
    const [updated] = await tx
      .update(editorialBriefs)
      .set({
        content: normalized.content as unknown as Record<string, unknown>,
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
    // Lock the project row first — serializes brief operations
    await lockProjectAndLoadChapterIds(input.projectId, tx);

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
    // Lock the project row and load current chapter IDs for coverage validation
    const currentChapterIds = await lockProjectAndLoadChapterIds(input.projectId, tx);

    // Load the brief without status filter to differentiate
    // "not found" (404) from "found but not a draft" (409).
    const [brief] = await tx
      .select()
      .from(editorialBriefs)
      .where(
        and(
          eq(editorialBriefs.id, input.briefId),
          eq(editorialBriefs.projectId, input.projectId),
        ),
      )
      .for("update");

    if (!brief) {
      throw new Error("Editorial brief not found");
    }
    if (brief.status !== "draft") {
      throw new Error("Cannot approve a non-draft editorial brief");
    }

    // Load the brief's contracts for coverage validation
    const contractRows = await tx
      .select({ chapterId: chapterEditorialContracts.chapterId })
      .from(chapterEditorialContracts)
      .where(eq(chapterEditorialContracts.editorialBriefId, input.briefId));

    // Validate exact chapter coverage before approving
    assertExactChapterCoverage(
      contractRows.map((c) => c.chapterId),
      currentChapterIds,
    );

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

  const bundle = await enrichToBundle(brief, dbCtx);
  return assertExpectedEditorialBriefHash(bundle, input.expectedHash);
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
