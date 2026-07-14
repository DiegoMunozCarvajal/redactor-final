import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { projects, chapters } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { eq, asc } from "drizzle-orm";
import { csrfCheck } from "@/lib/api/csrf";
import { logAudit } from "@/lib/audit";
import { mapRepoError } from "./map-repo-error";
import {
  createEditorialBriefDraft,
  getEditorialBriefBundle,
  getApprovedEditorialBriefBundle,
  getEditorialBriefHistory,
} from "@/lib/editorial-brief/repository";
import {
  reconcileChapterContracts,
  createEmptyContract,
} from "@/lib/editorial-brief/coverage";
import type {
  EditorialBriefContent,
  ChapterEditorialContract,
} from "@/lib/editorial-brief/schema";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Minimal editorial brief content template for new ("empty") drafts.
 * Every string field satisfies the Zod min(1) constraint.
 */
const EMPTY_BRIEF_CONTENT: EditorialBriefContent = {
  market: { region: "-", researchLanguage: "-", manuscriptLanguage: "-" },
  audience: {
    primaryReader: "-",
    situation: "-",
    pain: "-",
    awareness: "-",
    objections: ["-"],
  },
  thesis: {
    coreProblem: "-",
    desiredOutcome: "-",
    promise: "-",
    mechanism: ["-"],
    realisticBoundary: "-",
  },
  voice: { tone: ["-"], posture: "-", readingLevel: "-", avoid: ["-"] },
  contentStrategy: {
    pillars: ["-"],
    requiredScenarios: ["-"],
    recurringPattern: ["-"],
    examplePolicy: "-",
  },
  guardrails: {
    ethicalPrinciples: ["-"],
    forbiddenClaims: ["-"],
    forbiddenFraming: ["-"],
  },
  evidence: { mode: "rag_optional", citationPolicy: "-" },
  packaging: { titleAngle: "-", hook: "-", seoTerms: ["-"] },
  researchBasis: { findings: ["-"], inferences: ["-"], limitations: ["-"] },
};

// ---------------------------------------------------------------------------
// GET — list active brief, current draft, and history
// ---------------------------------------------------------------------------

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id: projectId } = await params;

  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!project || project.userId !== user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  try {
    const active = await getApprovedEditorialBriefBundle(projectId);

    // Find current draft via history
    const history = await getEditorialBriefHistory(projectId);
    const latestDraft = history.find((h) => h.status === "draft");
    const draft = latestDraft
      ? await getEditorialBriefBundle({ projectId, briefId: latestDraft.id })
      : null;

    return NextResponse.json({ active, draft, history });
  } catch (err) {
    return mapRepoError(err);
  }
}

// ---------------------------------------------------------------------------
// POST — create a new draft (empty or cloned from existing brief)
// ---------------------------------------------------------------------------

const createBodySchema = z.object({
  baseBriefId: z.string().uuid().optional(),
});

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const csrfError = csrfCheck(_req);
  if (csrfError) return csrfError;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id: projectId } = await params;

  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!project || project.userId !== user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // Parse body
  let body: z.infer<typeof createBodySchema>;
  try {
    const text = await _req.text();
    body = createBodySchema.parse(text ? JSON.parse(text) : {});
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: `Invalid body: ${err.errors.map((e) => e.message).join("; ")}` },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    let brief;

    if (body.baseBriefId) {
      // Clone from existing brief
      const source = await getEditorialBriefBundle({
        projectId,
        briefId: body.baseBriefId,
      });
      if (!source) {
        return NextResponse.json(
          { error: "Source editorial brief not found" },
          { status: 404 },
        );
      }

      // Reconcile cloned contracts against current project chapters.
      // Dropped chapters lose their contracts; new chapters get empty stubs.
      const currentChapters = await db
        .select()
        .from(chapters)
        .where(eq(chapters.projectId, projectId))
        .orderBy(asc(chapters.position));

      const reconciled = reconcileChapterContracts(
        currentChapters.map((ch) => ch.id),
        source.contracts,
        createEmptyContract,
      );

      brief = await createEditorialBriefDraft({
        projectId,
        content: source.content,
        contracts: reconciled,
        evidenceSourceIds: source.evidenceSourceIds,
      });
    } else {
      // Create empty draft — load chapters to generate minimal contracts
      const projectChapters = await db
        .select()
        .from(chapters)
        .where(eq(chapters.projectId, projectId))
        .orderBy(asc(chapters.position));

      if (projectChapters.length === 0) {
        return NextResponse.json(
          { error: "Project has no chapters; cannot create editorial brief" },
          { status: 400 },
        );
      }

      brief = await createEditorialBriefDraft({
        projectId,
        content: EMPTY_BRIEF_CONTENT,
        contracts: projectChapters.map((ch) => createEmptyContract(ch.id)),
        evidenceSourceIds: [],
      });
    }

    await logAudit({
      userId: user.id,
      action: "editorial-brief.create",
      resourceType: "editorial_brief",
      resourceId: brief.id,
      metadata: { projectId, version: brief.version, clonedFrom: body.baseBriefId ?? null },
    });

    return NextResponse.json(brief, { status: 201 });
  } catch (err) {
    return mapRepoError(err);
  }
}
