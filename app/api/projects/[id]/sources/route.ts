import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects, sources, sourceChunks } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { eq, asc, sql } from "drizzle-orm";
import { generateEmbeddings } from "@/lib/ai/embeddings";
import { csrfCheck } from "@/lib/api/csrf";

function chunkText(text: string, chunkWords = 500, overlapWords = 100): string[] {
  const words = text.split(/\s+/);
  if (words.length <= chunkWords) return [text];

  const chunks: string[] = [];
  let start = 0;
  while (start < words.length) {
    const end = Math.min(start + chunkWords, words.length);
    chunks.push(words.slice(start, end).join(" "));
    start += chunkWords - overlapWords;
  }
  return chunks;
}

// GET: List sources for a project
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id: projectId } = await params;

  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!project || project.userId !== user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const rows = await db
    .select({
      id: sources.id,
      fileName: sources.fileName,
      fileType: sources.fileType,
      sourceKind: sources.sourceKind,
      citation: sources.citation,
      processed: sources.processed,
      chunkCount: sources.chunkCount,
      createdAt: sources.createdAt,
    })
    .from(sources)
    .where(eq(sources.projectId, projectId))
    .orderBy(asc(sources.createdAt))
    .limit(200);

  return NextResponse.json(rows);
}

// POST: Upload a source file
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const csrfError = csrfCheck(req);
  if (csrfError) return csrfError;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id: projectId } = await params;

  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!project || project.userId !== user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const formData = await req.formData();
  const file = formData.get("file");

  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }

  const fileName = file.name;
  const ext = fileName.split(".").pop()?.toLowerCase();

  if (ext !== "md" && ext !== "txt") {
    return NextResponse.json(
      { error: "Only .md and .txt files are supported" },
      { status: 400 },
    );
  }

  // Size check before reading to avoid memory exhaustion
  const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: `file too large, max ${MAX_FILE_SIZE / 1024 / 1024} MB` },
      { status: 400 },
    );
  }

  const text = await file.text();
  if (!text.trim()) {
    return NextResponse.json({ error: "file is empty" }, { status: 400 });
  }

  // Guard against excessive uploads: cap chunks and total sources per project
  const MAX_CHUNKS = 200;
  const MAX_SOURCES_PER_PROJECT = 50;

  // Reserve source slot BEFORE chunking/embedding (expensive API calls).
  // Inserting a pending source atomically reserves quota — concurrent uploads
  // near the limit can't both pass the check, so paid embeddings are never
  // wasted on a quota-rejected insert.
  const fileType = ext === "md" ? "markdown" : "text";

  // Accept explicit sourceKind from form data, else auto-detect from filename
  const sourceKindForm = formData.get("sourceKind") as string | null;
  let sourceKind: "reference" | "example" | "mixed" | "unknown";
  if (sourceKindForm === "reference" || sourceKindForm === "example") {
    sourceKind = sourceKindForm;
  } else {
    // Detect source kind from filename
    sourceKind = "unknown";
    const lowerName = fileName.toLowerCase();
    const hasRef = /\b(referenc|bibliog|paper|estudio|study|paper|art[ií]culo|fuente|source|cita|citation)\b/.test(lowerName);
    const hasEx = /\b(ejemplo|example|caso|case|ilustraci|illustrat)\b/.test(lowerName);
    if (hasRef && hasEx) sourceKind = "mixed";
    else if (hasRef) sourceKind = "reference";
    else if (hasEx) sourceKind = "example";
  }

  // Extract citation from first 80 chars
  const cleaned = text.replace(/\n/g, " ").replace(/\s+/g, " ").trim();
  const citation = cleaned.slice(0, 80) + (cleaned.length > 80 ? "..." : "");

  // Reserve a source slot atomically before paying for embeddings.
  // Source row starts with processed=false; finalized after embeddings succeed.
  let reservedSourceId: string;
  try {
    const reserved = await db.transaction(async (tx) => {
      await tx
        .select({ id: projects.id })
        .from(projects)
        .where(eq(projects.id, projectId))
        .for("update");

      const [{ count: sourceCount }] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(sources)
        .where(eq(sources.projectId, projectId));

      if (sourceCount >= MAX_SOURCES_PER_PROJECT) {
        return { overQuota: true as const, id: null as string | null };
      }

      const [src] = await tx
        .insert(sources)
        .values({
          projectId,
          fileName,
          fileType,
          sourceKind,
          extractedText: text,
          citation: citation.slice(0, 500),
          processed: false,
          chunkCount: 0,
        })
        .returning({ id: sources.id });

      return { overQuota: false as const, id: src.id };
    });

    if (reserved.overQuota) {
      return NextResponse.json(
        { error: `max ${MAX_SOURCES_PER_PROJECT} sources per project` },
        { status: 400 },
      );
    }
    reservedSourceId = reserved.id!;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[sources] Failed to reserve source slot:", message);
    return NextResponse.json(
      { error: "Failed to reserve source slot" },
      { status: 500 },
    );
  }

  // Chunk, embed, and finalize — any failure must clean up the reserved
  // source row so it doesn't permanently consume quota (orphan).
  let chunks: string[];
  let embeddings: number[][];
  try {
    chunks = chunkText(text);
    if (chunks.length === 0) {
      throw new ValidationError("file has no content to chunk", 400);
    }
    if (chunks.length > MAX_CHUNKS) {
      throw new ValidationError(
        `file produces ${chunks.length} chunks, max ${MAX_CHUNKS}`,
        400,
      );
    }

    embeddings = await generateEmbeddings(chunks);

    // Finalize the reserved source with embeddings and chunks.
    // The slot was reserved before embeddings so no concurrent upload
    // can steal quota after the paid API call.
    const finalized = await db.transaction(async (tx) => {
      // Lock the reserved source row to prevent concurrent finalization
      await tx
        .select({ id: sources.id })
        .from(sources)
        .where(eq(sources.id, reservedSourceId))
        .for("update");

      // Update the reserved source to processed with actual chunk count
      const [src] = await tx
        .update(sources)
        .set({
          processed: true,
          chunkCount: chunks.length,
        })
        .where(eq(sources.id, reservedSourceId))
        .returning({ id: sources.id });

      // Insert chunks
      const chunkRows = chunks.map((content, i) => ({
        sourceId: src.id,
        projectId,
        chunkIndex: i,
        content,
        tokenCount: content.split(/\s+/).length,
        embedding: embeddings[i],
      }));

      const BATCH = 50;
      for (let i = 0; i < chunkRows.length; i += BATCH) {
        const batch = chunkRows.slice(i, i + BATCH);
        await tx.insert(sourceChunks).values(batch);
      }

      return [src];
    });

    const src = finalized[0];
    if (!src) {
      throw new Error("Source row disappeared between reservation and finalization");
    }
    return NextResponse.json({
      id: src.id,
      fileName,
      chunkCount: chunks.length,
      sourceKind,
    });
  } catch (err) {
    // Clean up the reserved (processed=false) row so it doesn't
    // permanently consume quota after a chunk/embed/finalize failure.
    await db
      .delete(sources)
      .where(eq(sources.id, reservedSourceId))
      .catch(() => {}); // Best-effort cleanup

    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error("[sources] Upload failed:", message);
    return NextResponse.json(
      { error: "Failed to process uploaded file" },
      { status: 500 },
    );
  }
}

class ValidationError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ValidationError";
    this.status = status;
  }
}
