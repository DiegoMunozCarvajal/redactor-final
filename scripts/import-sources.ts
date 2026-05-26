/**
 * Import .md source files into a project's RAG corpus.
 *
 * Usage: npx tsx scripts/import-sources.ts <projectId>
 *
 * Reads all .md files from libro-capitulos/, chunks them (~500 words,
 * ~100 word overlap), generates OpenAI embeddings, and inserts into DB.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { loadEnvFile } from "node:process";

if (!process.env.DATABASE_URL && existsSync(".env")) {
  loadEnvFile(".env");
}
import { db } from "../lib/db";
import { sources } from "../lib/db/schema/sources";
import { sourceChunks } from "../lib/db/schema/sources";
import { generateEmbeddings } from "../lib/ai/embeddings";
import { eq } from "drizzle-orm";

const CHUNK_WORDS = 500;
const OVERLAP_WORDS = 100;
const SOURCE_DIR = join(process.cwd(), "libro-capitulos");

function chunkText(text: string, chunkWords: number, overlapWords: number): string[] {
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

function extractCitation(fileName: string, text: string): string | null {
  // Use the first ~50 meaningful characters as citation
  const cleaned = text.replace(/\n/g, " ").replace(/\s+/g, " ").trim();
  return cleaned.slice(0, 80) + (cleaned.length > 80 ? "..." : "");
}

function detectSourceKind(fileName: string): "reference" | "example" | "mixed" | "unknown" {
  const lower = fileName.toLowerCase();
  const hasRef = /\b(referenc|bibliog|paper|estudio|study|paper|art[ií]culo|fuente|source|cita|citation)\b/.test(lower);
  const hasEx = /\b(ejemplo|example|caso|case|ilustraci|illustrat)\b/.test(lower);
  if (hasRef && hasEx) return "mixed";
  if (hasRef) return "reference";
  if (hasEx) return "example";
  return "unknown";
}

async function importSources(projectId: string) {
  // Validate project exists
  const { projects } = await import("../lib/db/schema/projects");
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) {
    console.error(`Project ${projectId} not found.`);
    process.exit(1);
  }
  console.log(`Importing sources into project: ${project.name} (${projectId})\n`);

  // Read .md files
  let files: string[];
  try {
    files = readdirSync(SOURCE_DIR).filter((f) => f.endsWith(".md"));
  } catch {
    console.error(`Directory not found: ${SOURCE_DIR}`);
    process.exit(1);
  }

  if (files.length === 0) {
    console.log("No .md files found in libro-capitulos/");
    return;
  }

  console.log(`Found ${files.length} .md files\n`);

  for (const file of files) {
    const filePath = join(SOURCE_DIR, file);
    const stat = statSync(filePath);
    const text = readFileSync(filePath, "utf-8");
    const wordCount = text.split(/\s+/).length;

    console.log(`  ${file} (${(stat.size / 1024).toFixed(1)} KB, ~${wordCount} words)`);

    const citation = extractCitation(file, text);
    const sourceKind = detectSourceKind(file);

    // Chunk the text
    const chunks = chunkText(text, CHUNK_WORDS, OVERLAP_WORDS);
    console.log(`    → ${chunks.length} chunks`);

    if (chunks.length === 0) continue;

    // Generate embeddings for all chunks
    process.stdout.write(`    → generating embeddings...`);
    const embeddings = await generateEmbeddings(chunks);
    console.log(` done (${embeddings.length})`);

    // Insert source
    const [inserted] = await db
      .insert(sources)
      .values({
        projectId,
        fileName: file,
        fileType: "markdown",
        sourceKind,
        extractedText: text,
        citation: citation?.slice(0, 500) ?? null,
        processed: true,
        chunkCount: chunks.length,
      })
      .returning({ id: sources.id });

    // Insert chunks with embeddings
    const chunkRows = chunks.map((content, i) => ({
      sourceId: inserted.id,
      projectId,
      chunkIndex: i,
      content,
      tokenCount: content.split(/\s+/).length,
      embedding: embeddings[i],
    }));

    // Insert in batches of 50 to avoid huge inserts
    const BATCH = 50;
    for (let i = 0; i < chunkRows.length; i += BATCH) {
      const batch = chunkRows.slice(i, i + BATCH);
      await db.insert(sourceChunks).values(batch);
    }

    console.log(`    → inserted source ${inserted.id.slice(0, 8)}... with ${chunkRows.length} chunks\n`);
  }

  console.log("Done.");
  process.exit(0);
}

const projectId = process.argv[2];
if (!projectId) {
  console.error("Usage: npx tsx scripts/import-sources.ts <projectId>");
  process.exit(1);
}

importSources(projectId).catch((err) => {
  console.error("Import failed:", err);
  process.exit(1);
});
