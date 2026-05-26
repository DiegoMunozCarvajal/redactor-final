import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects, sources, sourceChunks } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { eq, asc } from "drizzle-orm";
import { generateEmbeddings } from "@/lib/ai/embeddings";

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
    .orderBy(asc(sources.createdAt));

  return NextResponse.json(rows);
}

// POST: Upload a source file
export async function POST(
  req: NextRequest,
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

  const text = await file.text();
  if (!text.trim()) {
    return NextResponse.json({ error: "file is empty" }, { status: 400 });
  }

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

  // Chunk and embed
  const chunks = chunkText(text);
  if (chunks.length === 0) {
    return NextResponse.json({ error: "file has no content to chunk" }, { status: 400 });
  }

  let embeddings: number[][];
  try {
    embeddings = await generateEmbeddings(chunks);
  } catch (err) {
    console.error("[sources] Embedding generation failed:", err);
    return NextResponse.json(
      { error: "Failed to generate embeddings" },
      { status: 500 },
    );
  }

  // Insert source
  const [inserted] = await db
    .insert(sources)
    .values({
      projectId,
      fileName,
      fileType,
      sourceKind,
      extractedText: text,
      citation: citation.slice(0, 500),
      processed: true,
      chunkCount: chunks.length,
    })
    .returning({ id: sources.id });

  // Insert chunks
  const chunkRows = chunks.map((content, i) => ({
    sourceId: inserted.id,
    projectId,
    chunkIndex: i,
    content,
    tokenCount: content.split(/\s+/).length,
    embedding: embeddings[i],
  }));

  const BATCH = 50;
  for (let i = 0; i < chunkRows.length; i += BATCH) {
    const batch = chunkRows.slice(i, i + BATCH);
    await db.insert(sourceChunks).values(batch);
  }

  return NextResponse.json({
    id: inserted.id,
    fileName,
    chunkCount: chunks.length,
    sourceKind,
  });
}
