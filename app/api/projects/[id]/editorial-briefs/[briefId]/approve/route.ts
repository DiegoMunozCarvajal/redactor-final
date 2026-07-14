import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { eq } from "drizzle-orm";
import { csrfCheck } from "@/lib/api/csrf";
import { logAudit } from "@/lib/audit";
import { approveEditorialBrief } from "@/lib/editorial-brief/repository";
import { mapRepoError } from "../../map-repo-error";

// ---------------------------------------------------------------------------
// POST — approve a draft editorial brief
// ---------------------------------------------------------------------------

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; briefId: string }> },
) {
  const csrfError = csrfCheck(_req);
  if (csrfError) return csrfError;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id: projectId, briefId } = await params;

  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!project || project.userId !== user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  try {
    const brief = await approveEditorialBrief({ briefId, projectId });

    await logAudit({
      userId: user.id,
      action: "editorial-brief.approve",
      resourceType: "editorial_brief",
      resourceId: brief.id,
      metadata: { projectId, version: brief.version },
    });

    return NextResponse.json(brief);
  } catch (err) {
    return mapRepoError(err);
  }
}
