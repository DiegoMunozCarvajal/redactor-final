import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { projects, chapterPlaceholders, placeholderVersions, chapters } from '@/lib/db/schema';
import { createClient } from '@/lib/supabase/server';
import { eq, and } from 'drizzle-orm';
import { csrfCheck } from '@/lib/api/csrf';
import type { PlaceholderFillMetadata } from '@/lib/placeholder-fill-metadata';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; chapterId: string; name: string }> },
) {
  const csrfError = csrfCheck(req);
  if (csrfError) return csrfError;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { id: projectId, chapterId, name } = await params;

  // Verify project ownership
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project || project.userId !== user.id) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  // Verify chapter belongs to project
  const [chapter] = await db
    .select({ id: chapters.id })
    .from(chapters)
    .where(and(eq(chapters.id, chapterId), eq(chapters.projectId, projectId)))
    .limit(1);
  if (!chapter) return NextResponse.json({ error: 'chapter not found' }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const { activeVersionId } = body;

  if (!activeVersionId || typeof activeVersionId !== 'string') {
    return NextResponse.json({ error: 'activeVersionId required' }, { status: 400 });
  }

  // Get the placeholder row
  const [placeholderRow] = await db
    .select()
    .from(chapterPlaceholders)
    .where(and(eq(chapterPlaceholders.chapterId, chapterId), eq(chapterPlaceholders.name, name)))
    .limit(1);

  if (!placeholderRow) {
    return NextResponse.json({ error: 'placeholder not found' }, { status: 404 });
  }

  // Verify version belongs to this placeholder
  const [version] = await db
    .select()
    .from(placeholderVersions)
    .where(
      and(
        eq(placeholderVersions.id, activeVersionId),
        eq(placeholderVersions.placeholderId, placeholderRow.id),
      ),
    )
    .limit(1);

  if (!version) {
    return NextResponse.json({ error: 'version not found for this placeholder' }, { status: 404 });
  }

  // Update active version
  const versionMeta = (version.fillMetadata ?? {}) as PlaceholderFillMetadata;
  await db
    .update(chapterPlaceholders)
    .set({
      definition: version.definition,
      activeVersionId: version.id,
      definitionOrigin: versionMeta.definitionOrigin ?? 'ai',
    })
    .where(and(eq(chapterPlaceholders.chapterId, chapterId), eq(chapterPlaceholders.name, name)));

  return NextResponse.json({
    name,
    definition: version.definition,
    activeVersionId: version.id,
    definitionOrigin: versionMeta.definitionOrigin ?? 'ai',
  });
}
