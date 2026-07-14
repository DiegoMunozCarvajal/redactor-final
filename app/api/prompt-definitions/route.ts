import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { promptDefinitions, promptRevisions, promptKindValues } from "@/lib/db/schema/prompt-registry";
import { eq, asc, desc } from "drizzle-orm";
import { csrfCheck } from "@/lib/api/csrf";
import { requireAdmin } from "@/lib/auth/admin";
import { createClient } from "@/lib/supabase/server";

const createDefinitionSchema = z.object({
  kind: z.enum(promptKindValues),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).nullable().optional(),
});

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const kind = searchParams.get("kind");

  if (kind && !(promptKindValues as readonly string[]).includes(kind)) {
    return NextResponse.json({ error: `invalid kind: ${kind}` }, { status: 400 });
  }

  const base = db.select().from(promptDefinitions).$dynamic();
  if (kind) base.where(eq(promptDefinitions.kind, kind));

  const definitions = await base.orderBy(asc(promptDefinitions.createdAt)).limit(100);

  // Attach latest revision info
  const result = await Promise.all(
    definitions.map(async (def) => {
      const [latest] = await db
        .select({
          id: promptRevisions.id,
          versionLabel: promptRevisions.versionLabel,
          revisionNumber: promptRevisions.revisionNumber,
        })
        .from(promptRevisions)
        .where(eq(promptRevisions.promptDefinitionId, def.id))
        .orderBy(desc(promptRevisions.revisionNumber))
        .limit(1);

      return {
        ...def,
        latestRevision: latest ?? null,
      };
    }),
  );

  return NextResponse.json(result);
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
