import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { promptKindValues } from "@/lib/db/schema/prompt-registry";
import type { PromptKind } from "@/lib/db/schema/prompt-registry";
import { csrfCheck } from "@/lib/api/csrf";
import { requireAdmin } from "@/lib/auth/admin";
import { createClient } from "@/lib/supabase/server";
import { listPromptDefinitionSummaries } from "@/lib/prompts/admin-repository";
import { db } from "@/lib/db";
import { promptDefinitions } from "@/lib/db/schema/prompt-registry";

const createDefinitionSchema = z.object({
  kind: z.enum(promptKindValues),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).nullable().optional(),
});

const archiveViewSchema = z.enum(["active", "archived", "all"]);

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const params = new URL(req.url).searchParams;
  const kind = params.get("kind");
  const archiveResult = archiveViewSchema.safeParse(params.get("archive") ?? "active");

  if (kind && !(promptKindValues as readonly string[]).includes(kind)) {
    return NextResponse.json({ error: `invalid kind: ${kind}` }, { status: 400 });
  }
  if (!archiveResult.success) {
    return NextResponse.json(
      { error: "archive must be active, archived, or all" },
      { status: 400 },
    );
  }

  return NextResponse.json(
    await listPromptDefinitionSummaries({
      kind: kind as PromptKind | undefined,
      archive: archiveResult.data,
    }),
  );
}

export async function POST(req: NextRequest) {
  const csrfError = csrfCheck(req);
  if (csrfError) return csrfError;

  const admin = await requireAdmin();
  if (!admin.authorized) return admin.response;

  const body = await req.json().catch(() => ({}));
  const parsed = createDefinitionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid body", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const [def] = await db
    .insert(promptDefinitions)
    .values({ ...parsed.data, createdBy: admin.user.id })
    .returning();

  return NextResponse.json(def, { status: 201 });
}
