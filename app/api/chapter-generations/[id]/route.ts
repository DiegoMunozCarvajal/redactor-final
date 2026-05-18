import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { chapterGenerations, fragments, projects } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { eq, asc } from "drizzle-orm";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;

  const [gen] = await db
    .select()
    .from(chapterGenerations)
    .where(eq(chapterGenerations.id, id))
    .limit(1);
  if (!gen)
    return NextResponse.json({ error: "not found" }, { status: 404 });

  // Verify via project ownership
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, gen.projectId))
    .limit(1);
  if (!project || project.userId !== user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const frags = await db
    .select()
    .from(fragments)
    .where(eq(fragments.chapterGenerationId, id))
    .orderBy(asc(fragments.position));

  return NextResponse.json({ ...gen, fragments: frags });
}
