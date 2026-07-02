import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { promptLibrary } from "@/lib/db/schema";
import { eq, asc } from "drizzle-orm";
import { csrfCheck } from "@/lib/api/csrf";
import { requireAdmin } from "@/lib/auth/admin";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";

const VALID_CATEGORIES = ["assembly", "critique", "corrector"] as const;

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const category = searchParams.get("category");

  const base = db.select().from(promptLibrary).$dynamic();
  if (category && VALID_CATEGORIES.includes(category as (typeof VALID_CATEGORIES)[number])) {
    base.where(eq(promptLibrary.category, category));
  }
  const rows = await base.orderBy(asc(promptLibrary.createdAt)).limit(100);

  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const csrfError = csrfCheck(req);
  if (csrfError) return csrfError;

  const admin = await requireAdmin();
  if (!admin.authorized) return admin.response;

  const body = await req.json().catch(() => ({}));
  const { category, name, description, content, userPrompt } = body;

  if (!name || !content) {
    return NextResponse.json({ error: "name and content are required" }, { status: 400 });
  }
  if (!category || !VALID_CATEGORIES.includes(category)) {
    return NextResponse.json(
      { error: `category must be one of: ${VALID_CATEGORIES.join(", ")}` },
      { status: 400 },
    );
  }

  // Validate required content markers per category so the LLM actually
  // receives the material it needs (fragments, chapter text, critique text).
  // Runtime fallbacks exist in lib/generate.ts, but save-time validation
  // catches missing markers early and avoids silent empty outputs.
  const MARKERS_BY_CATEGORY: Record<string, RegExp> = {
    assembly: /\{\{SECCIONES_GENERADAS\}\}|\[PEGAR AQUÍ TODOS LOS FRAGMENTOS DEL CAPÍTULO\]|\[PASTE ALL CHAPTER FRAGMENTS HERE\]/,
    critique: /\{\{CONTENIDO_CAPITULO\}\}|\[PEGAR AQUÍ EL CAPÍTULO A CRITICAR\]|\[PEGAR AQUÍ EL CAPÍTULO COMPLETO\]/,
    corrector: /\{\{CONTENIDO_CAPITULO\}\}|\{\{CONTENIDO_CRITICA\}\}/,
  };
  const markerRegex = MARKERS_BY_CATEGORY[category];
  const checkText = [content, userPrompt].filter((s): s is string => typeof s === "string" && s.length > 0).join("\n");
  if (markerRegex && !markerRegex.test(checkText)) {
    return NextResponse.json(
      { error: `prompt content must include a content marker for category "${category}". See prompt library docs for required markers.` },
      { status: 400 },
    );
  }

  const [row] = await db
    .insert(promptLibrary)
    .values({ category, name, description: description ?? null, content, userPrompt: userPrompt ?? null })
    .returning();

  await logAudit({
    userId: admin.user.id,
    action: "prompt_library.create",
    resourceType: "prompt_library",
    resourceId: row.id,
    metadata: { name: row.name, category: row.category },
  });

  return NextResponse.json(row);
}
