import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { runs, chapterRuns, fragments, projects } from "@/lib/db/schema";
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

  const [run] = await db.select().from(runs).where(eq(runs.id, id)).limit(1);
  if (!run)
    return NextResponse.json({ error: "not found" }, { status: 404 });

  // Verify via project ownership
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, run.projectId))
    .limit(1);
  if (!project || project.userId !== user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // Load chapter runs with fragments
  const crs = await db
    .select()
    .from(chapterRuns)
    .where(eq(chapterRuns.runId, id))
    .orderBy(asc(chapterRuns.position));

  const chaptersWithFragments = await Promise.all(
    crs.map(async (cr) => {
      const frags = await db
        .select()
        .from(fragments)
        .where(eq(fragments.chapterRunId, cr.id))
        .orderBy(asc(fragments.position));
      return { ...cr, fragments: frags };
    }),
  );

  return NextResponse.json({ ...run, chapterRuns: chaptersWithFragments });
}
