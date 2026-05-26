import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { bookTemplates, chapters } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { csrfCheck } from "@/lib/api/csrf";
import { ensureTriggerConfigured } from "@/lib/trigger/setup";
import { generateTemplate } from "@/trigger/generate-template";
import { sanitizeError } from "@/lib/sanitize-error";
import { logAudit } from "@/lib/audit";

export async function POST(req: NextRequest) {
  const csrfError = csrfCheck(req);
  if (csrfError) return csrfError;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { name, description, metaPromptId, chapters: chapterList } = body;

  if (!name || typeof name !== "string" || name.length < 1 || name.length > 200) {
    return NextResponse.json({ error: "name must be 1-200 characters" }, { status: 400 });
  }
  if (!metaPromptId || typeof metaPromptId !== "string") {
    return NextResponse.json({ error: "metaPromptId is required" }, { status: 400 });
  }
  if (!Array.isArray(chapterList) || chapterList.length === 0) {
    return NextResponse.json({ error: "chapters must be a non-empty array" }, { status: 400 });
  }

  for (let i = 0; i < chapterList.length; i++) {
    const ch = chapterList[i];
    if (!ch.contentMd || typeof ch.contentMd !== "string" || ch.contentMd.trim().length === 0) {
      return NextResponse.json({ error: `chapters[${i}].contentMd is required` }, { status: 400 });
    }
    if (ch.contentMd.length > 500_000) {
      return NextResponse.json({ error: `chapters[${i}].contentMd exceeds 500KB limit` }, { status: 400 });
    }
  }

  try {
    const template = await db.transaction(async (tx) => {
      const [tpl] = await tx
        .insert(bookTemplates)
        .values({ name: name.trim(), description: description?.trim() || null })
        .returning();

      const createdChapters: { id: string; title: string; position: number }[] = [];

      for (let i = 0; i < chapterList.length; i++) {
        const title = `Capítulo ${i + 1}`;
        const [ch] = await tx
          .insert(chapters)
          .values({
            bookTemplateId: tpl.id,
            position: i,
            title,
          })
          .returning();
        createdChapters.push({ id: ch.id, title, position: i });
      }

      return { template: tpl, createdChapters };
    });

    // Build chapter payload for the background task
    const chapterPayloads = template.createdChapters.map((ch, i) => ({
      chapterId: ch.id,
      title: ch.title,
      contentMd: chapterList[i].contentMd,
      position: ch.position,
    }));

    ensureTriggerConfigured();
    await generateTemplate.trigger({
      templateId: template.template.id,
      metaPromptId,
      chapters: chapterPayloads,
    });

    logAudit({
      userId: user.id,
      action: "template.auto_create",
      resourceType: "book_template",
      resourceId: template.template.id,
      metadata: {
        name: template.template.name,
        metaPromptId,
        chapterCount: template.createdChapters.length,
      },
    });

    return NextResponse.json(template.template);
  } catch (err) {
    const message = sanitizeError(err);
    console.error("Failed to auto-create template:", message);
    return NextResponse.json({ error: "failed to create template" }, { status: 500 });
  }
}
