import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  projectPromptBindings,
  promptRevisions,
  promptDefinitions,
  promptKindValues,
} from "@/lib/db/schema/prompt-registry";
import { projects } from "@/lib/db/schema/projects";
import { eq, and, desc } from "drizzle-orm";
import { csrfCheck } from "@/lib/api/csrf";
import { createClient } from "@/lib/supabase/server";
import { resolvePromptRevision } from "@/lib/prompts/repository";
import type { PromptKind } from "@/lib/db/schema/prompt-registry";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id: projectId } = await params;

  // Verify project ownership
  const [project] = await db
    .select({ id: projects.id, userId: projects.userId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  if (!project || project.userId !== user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const bindings = await db
    .select({
      kind: projectPromptBindings.kind,
      promptRevisionId: projectPromptBindings.promptRevisionId,
      updatedAt: projectPromptBindings.updatedAt,
      versionLabel: promptRevisions.versionLabel,
      definitionName: promptDefinitions.name,
    })
    .from(projectPromptBindings)
    .innerJoin(
      promptRevisions,
      eq(projectPromptBindings.promptRevisionId, promptRevisions.id),
    )
    .innerJoin(
      promptDefinitions,
      eq(promptRevisions.promptDefinitionId, promptDefinitions.id),
    )
    .where(eq(projectPromptBindings.projectId, projectId))
    .orderBy(desc(projectPromptBindings.updatedAt));

  return NextResponse.json(bindings);
}

const setBindingSchema = z.object({
  kind: z.enum(promptKindValues),
  promptRevisionId: z.string().uuid(),
});

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const csrfError = csrfCheck(req);
  if (csrfError) return csrfError;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id: projectId } = await params;

  // Verify project ownership
  const [project] = await db
    .select({ id: projects.id, userId: projects.userId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  if (!project || project.userId !== user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = setBindingSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid body", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  // Verify revision exists, is executable, kind matches, and definition is
  // not archived — all inside a transaction that locks the definition row so
  // a concurrent archive cannot slip between check and upsert.
  try {
    await db.transaction(async (tx) => {
      const resolved = await resolvePromptRevision(
        { kind: parsed.data.kind as PromptKind, runRevisionId: parsed.data.promptRevisionId },
        tx,
      );

      // Lock the definition row to serialise with concurrent archive
      await tx
        .select({ id: promptDefinitions.id })
        .from(promptDefinitions)
        .where(eq(promptDefinitions.id, resolved.definitionId))
        .for("update");

      await tx
        .insert(projectPromptBindings)
        .values({
          projectId,
          kind: parsed.data.kind as PromptKind,
          promptRevisionId: parsed.data.promptRevisionId,
        })
        .onConflictDoUpdate({
          target: [projectPromptBindings.projectId, projectPromptBindings.kind],
          set: {
            promptRevisionId: parsed.data.promptRevisionId,
            updatedAt: new Date(),
          },
        });
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  return NextResponse.json({
    projectId,
    kind: parsed.data.kind,
    promptRevisionId: parsed.data.promptRevisionId,
  });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const csrfError = csrfCheck(req);
  if (csrfError) return csrfError;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id: projectId } = await params;

  // Verify project ownership
  const [project] = await db
    .select({ id: projects.id, userId: projects.userId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  if (!project || project.userId !== user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const { searchParams } = new URL(req.url);
  const kind = searchParams.get("kind");

  if (!kind || !(promptKindValues as readonly string[]).includes(kind)) {
    return NextResponse.json({ error: "kind query parameter is required" }, { status: 400 });
  }

  await db
    .delete(projectPromptBindings)
    .where(
      and(
        eq(projectPromptBindings.projectId, projectId),
        eq(projectPromptBindings.kind, kind as PromptKind),
      ),
    );

  return NextResponse.json({ ok: true });
}
