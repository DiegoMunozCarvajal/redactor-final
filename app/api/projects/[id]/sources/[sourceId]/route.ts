import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects, sources } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { eq } from "drizzle-orm";
import { csrfCheck } from "@/lib/api/csrf";
import { deleteSourceFile } from "@/lib/storage/sources";
import { sanitizeStorageFileName } from "@/lib/storage/object-key";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; sourceId: string }> },
) {
  const csrfError = csrfCheck(req);
  if (csrfError) return csrfError;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id: projectId, sourceId } = await params;

  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!project || project.userId !== user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const [source] = await db
    .select()
    .from(sources)
    .where(eq(sources.id, sourceId))
    .limit(1);
  if (!source || source.projectId !== projectId) {
    return NextResponse.json({ error: "source not found" }, { status: 404 });
  }

  // Delete DB row (chunks cascade-delete via FK)
  await db.delete(sources).where(eq(sources.id, sourceId));

  // Best-effort: also remove the file from Supabase Storage if it exists.
  // Storage path follows the same convention as uploadSourceFile().
  const safeFileName = sanitizeStorageFileName(source.fileName, source.id);
  const storagePath = `${projectId}/${source.id}/${safeFileName}`;
  try {
    await deleteSourceFile(storagePath, user.id);
  } catch (err) {
    // File may never have been uploaded (sources store text in DB by default).
    // Log and continue — the DB row is already deleted.
    console.warn("[sources] Storage cleanup failed (may be expected):", err instanceof Error ? err.message : String(err));
  }

  return NextResponse.json({ ok: true });
}
