import { chapters, chapterGenerations, fragments } from "@/lib/db/schema";
import { eq, and, lt, inArray, desc, asc } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "@/lib/db/schema";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single block's key-value pairs. */
export type ExtractedBlock = Record<string, string>;

/** Map of block name to its key-value pairs. */
export type ExtractedBlocks = Record<string, ExtractedBlock>;

// ---------------------------------------------------------------------------
// XML escaping
// ---------------------------------------------------------------------------

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/**
 * Extract [BLOCK_NAME] metadata blocks with key-value pairs from the end
 * of fragment text.
 *
 * Expected format (contiguous at the end of the text):
 *   [NOMBRE_BLOQUE]
 *   - `campo`: valor
 *   - `campo2`: valor2
 *
 *   [OTRO_BLOQUE]
 *   - `campo3`: valor3
 *
 * Blocks are contiguous and separated by blank lines. All block content
 * must be at the very end of the text — any non-block content after blocks
 * prevents extraction.
 *
 * Returns the extracted blocks and the cleaned text with blocks removed.
 * If no blocks are found, returns empty blocks and the original text.
 */
export function extractMetadataBlocks(text: string): {
  blocks: ExtractedBlocks;
  cleanedText: string;
} {
  if (text.length === 0) {
    return { blocks: {}, cleanedText: text };
  }

  const lines = text.split("\n");

  // Scan from the end backwards to find the block region boundary
  let scanIdx = lines.length - 1;

  // Skip trailing blank lines
  while (scanIdx >= 0 && lines[scanIdx].trim() === "") {
    scanIdx--;
  }

  if (scanIdx < 0) {
    return { blocks: {}, cleanedText: text };
  }

  const blockEndIdx = scanIdx;
  let foundBlockHeader = false;

  while (scanIdx >= 0) {
    const line = lines[scanIdx];
    const trimmed = line.trim();

    if (trimmed === "") {
      scanIdx--;
      continue;
    }

    // Match [BLOCK_NAME] — any characters between brackets
    const isBlockName = /^\[[^\]]+\]$/.test(trimmed);
    // Match - `key`: value
    const isKeyValue = /^- `[^`]*`:\s/.test(trimmed);

    if (isBlockName) {
      foundBlockHeader = true;
      scanIdx--;
      continue;
    }

    if (isKeyValue) {
      scanIdx--;
      continue;
    }

    // Non-block content encountered — stop scanning
    break;
  }

  const blockStartIdx = scanIdx + 1;

  if (!foundBlockHeader) {
    return { blocks: {}, cleanedText: text };
  }

  // Split into block region and clean text
  const blockLines = lines.slice(blockStartIdx, blockEndIdx + 1);
  const cleanLines = lines.slice(0, blockStartIdx);

  // Parse blocks
  const extracted: ExtractedBlocks = {};
  let currentBlockName = "";

  for (const line of blockLines) {
    const trimmed = line.trim();
    if (trimmed === "") continue;

    const nameMatch = trimmed.match(/^\[([^\]]+)\]$/);
    if (nameMatch) {
      currentBlockName = nameMatch[1];
      extracted[currentBlockName] = {};
      continue;
    }

    const kvMatch = trimmed.match(/^- `([^`]*)`:\s(.*)$/);
    if (kvMatch && currentBlockName) {
      extracted[currentBlockName][kvMatch[1]] = kvMatch[2];
    }
  }

  const cleanedText = cleanLines.join("\n").trimEnd();

  return { blocks: extracted, cleanedText };
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

/**
 * Render extracted blocks as XML for inclusion in LLM context.
 *
 * Output format:
 *   <extracted_block name="NOMBRE_BLOQUE">
 *     <field name="campo">valor</field>
 *   </extracted_block>
 */
export function renderExtractedBlocksXML(blocks: ExtractedBlocks): string {
  const parts: string[] = [];

  for (const [blockName, fields] of Object.entries(blocks)) {
    const fieldParts: string[] = [];
    for (const [key, value] of Object.entries(fields)) {
      fieldParts.push(
        `      <field name="${escapeXml(key)}">${escapeXml(value)}</field>`,
      );
    }
    parts.push(
      [
        `    <extracted_block name="${escapeXml(blockName)}">`,
        ...fieldParts,
        "    </extracted_block>",
      ].join("\n"),
    );
  }

  return parts.join("\n\n");
}

// ---------------------------------------------------------------------------
// Cross-chapter loader
// ---------------------------------------------------------------------------

type PgSchema = typeof schema;
type DB = PostgresJsDatabase<PgSchema>;

/**
 * Load extracted metadata blocks from previous chapters' completed
 * generations and render them as an XML context block.
 *
 * For each chapter with `position < currentPosition`, fetches the latest
 * completed generation's fragments that have `extractedBlocks` in their
 * metadata. Returns `null` if no blocks are found.
 *
 * Output XML:
 *   <previous_chapters_context>
 *     <chapter position="1" title="Chapter Title">
 *       <extracted_block name="CONTEXTO_NARRATIVO">
 *         <field name="imagen_apertura">value</field>
 *       </extracted_block>
 *     </chapter>
 *   </previous_chapters_context>
 */
export async function loadPreviousChaptersContext(
  _db: DB,
  projectId: string,
  currentPosition: number,
): Promise<string | null> {
  // 1. Get all previous chapters ordered by position
  const previousChapters = await _db
    .select({
      id: chapters.id,
      title: chapters.title,
      position: chapters.position,
    })
    .from(chapters)
    .where(
      and(
        eq(chapters.projectId, projectId),
        lt(chapters.position, currentPosition),
      ),
    )
    .orderBy(asc(chapters.position));

  if (previousChapters.length === 0) return null;

  const chapterIds = previousChapters.map((c) => c.id);

  // 2. Get all completed generations for these chapters, ordered by
  //    completedAt descending so the first entry per chapter is the latest
  const allGens = await _db
    .select({
      id: chapterGenerations.id,
      chapterId: chapterGenerations.chapterId,
      completedAt: chapterGenerations.completedAt,
    })
    .from(chapterGenerations)
    .where(
      and(
        inArray(chapterGenerations.chapterId, chapterIds),
        eq(chapterGenerations.status, "completed"),
      ),
    )
    .orderBy(desc(chapterGenerations.completedAt));

  if (allGens.length === 0) return null;

  // 3. Select the latest completed generation per chapter
  const latestGenPerChapter = new Map<string, string>(); // chapterId -> genId
  for (const gen of allGens) {
    if (!latestGenPerChapter.has(gen.chapterId)) {
      latestGenPerChapter.set(gen.chapterId, gen.id);
    }
  }

  const latestGenIds = [...latestGenPerChapter.values()];

  // Build reverse map: genId -> chapterId
  const genIdToChapterId = new Map<string, string>();
  for (const [chapterId, genId] of latestGenPerChapter) {
    genIdToChapterId.set(genId, chapterId);
  }

  // 4. Get fragments with extractedBlocks from these generations
  const frags = await _db
    .select({
      chapterGenerationId: fragments.chapterGenerationId,
      metadata: fragments.metadata,
    })
    .from(fragments)
    .where(inArray(fragments.chapterGenerationId, latestGenIds));

  if (frags.length === 0) return null;

  // 5. Group extracted blocks by chapter
  const chapterBlocks = new Map<string, ExtractedBlocks>();

  for (const f of frags) {
    const meta = f.metadata as {
      extractedBlocks?: ExtractedBlocks;
    } | null;
    if (!meta?.extractedBlocks) continue;

    const cId = genIdToChapterId.get(f.chapterGenerationId);
    if (!cId) continue;

    const existing = chapterBlocks.get(cId) ?? {};
    Object.assign(existing, meta.extractedBlocks);
    chapterBlocks.set(cId, existing);
  }

  if (chapterBlocks.size === 0) return null;

  // 6. Render as XML
  const chapterParts: string[] = [];

  for (const ch of previousChapters) {
    const blocks = chapterBlocks.get(ch.id);
    if (!blocks || Object.keys(blocks).length === 0) continue;

    const renderedBlocks = renderExtractedBlocksXML(blocks);
    chapterParts.push(
      [
        `  <chapter position="${ch.position}" title="${escapeXml(ch.title)}">`,
        renderedBlocks,
        "  </chapter>",
      ].join("\n"),
    );
  }

  if (chapterParts.length === 0) return null;

  return [
    "<previous_chapters_context>",
    ...chapterParts,
    "</previous_chapters_context>",
  ].join("\n");
}
