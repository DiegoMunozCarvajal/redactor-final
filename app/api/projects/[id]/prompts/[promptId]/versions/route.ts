import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects, promptVersions } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { eq, desc } from "drizzle-orm";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; promptId: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id: projectId, promptId } = await params;

  // Verify project ownership
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!project || project.userId !== user.id)
    return NextResponse.json({ error: "not found" }, { status: 404 });

  const versions = await db
    .select({
      id: promptVersions.id,
      title: promptVersions.title,
      createdAt: promptVersions.createdAt,
    })
    .from(promptVersions)
    .where(eq(promptVersions.promptId, promptId))
    .orderBy(desc(promptVersions.createdAt));

  return NextResponse.json(versions);
}
