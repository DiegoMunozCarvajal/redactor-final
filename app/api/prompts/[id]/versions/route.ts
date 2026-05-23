import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { promptVersions, projectPrompts, projects } from "@/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { createClient } from "@/lib/supabase/server";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;

  // Verify prompt belongs to user's project
  const [owned] = await db
    .select({ id: projectPrompts.id })
    .from(projectPrompts)
    .innerJoin(projects, eq(projectPrompts.projectId, projects.id))
    .where(and(eq(projectPrompts.id, id), eq(projects.userId, user.id)))
    .limit(1);
  if (!owned) return NextResponse.json({ error: "not found" }, { status: 404 });

  const versions = await db
    .select({
      id: promptVersions.id,
      title: promptVersions.title,
      createdAt: promptVersions.createdAt,
    })
    .from(promptVersions)
    .where(eq(promptVersions.promptId, id))
    .orderBy(desc(promptVersions.createdAt));

  return NextResponse.json(versions);
}
