import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects, runs } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { eq, desc } from "drizzle-orm";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const [project] = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
  if (!project || project.userId !== user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const runList = await db
    .select()
    .from(runs)
    .where(eq(runs.projectId, id))
    .orderBy(desc(runs.createdAt));

  return NextResponse.json({ ...project, runs: runList });
}
