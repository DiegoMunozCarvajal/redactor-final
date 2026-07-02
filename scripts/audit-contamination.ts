/**
 * Scan database for content matching known copyrighted works.
 *
 * Checks 5 columns across 3 tables:
 *   - prompts: content, notes, sourceContext
 *   - chapter_placeholders: definition
 *   - chapter_generations: assembledContent (from generation metadata)
 *
 * Usage: npx tsx scripts/audit-contamination.ts
 *
 * Output: table-formatted report to stdout showing table, column, id,
 * matched pattern, and a snippet of the matched text.
 */

import { db } from "../lib/db";
import { prompts, chapterPlaceholders, chapterGenerations } from "../lib/db/schema";
import { isNotNull } from "drizzle-orm";
import { checkBlocklist, CONTAMINATION_BLOCKLIST } from "../lib/ai/originality-check";

interface Finding {
  table: string;
  id: string;
  column: string;
  pattern: string;
  snippet: string;
}

async function main() {
  console.log("🔍 Audit de contaminación — escaneando base de datos...\n");

  const findings: Finding[] = [];

  // Scan prompts
  const allPrompts = await db
    .select({ id: prompts.id, content: prompts.content, notes: prompts.notes, sourceContext: prompts.sourceContext })
    .from(prompts);

  for (const p of allPrompts) {
    for (const col of ["content", "notes", "sourceContext"] as const) {
      const text = p[col];
      if (!text) continue;
      const hits = checkBlocklist(text);
      for (const pattern of hits) {
        findings.push({
          table: "prompts",
          id: p.id,
          column: col,
          pattern: pattern.slice(0, 80),
          snippet: extractSnippet(text, pattern),
        });
      }
    }
  }

  // Scan chapter_placeholders
  const allPlaceholders = await db
    .select({ id: chapterPlaceholders.id, definition: chapterPlaceholders.definition })
    .from(chapterPlaceholders)
    .where(isNotNull(chapterPlaceholders.definition));

  for (const ph of allPlaceholders) {
    const text = ph.definition;
    if (!text) continue;
    const hits = checkBlocklist(text);
    for (const pattern of hits) {
      findings.push({
        table: "chapter_placeholders",
        id: ph.id,
        column: "definition",
        pattern: pattern.slice(0, 80),
        snippet: extractSnippet(text, pattern),
      });
    }
  }

  // Scan chapter_generations — assembledContent has the actual generated text
  const allGens = await db
    .select({
      id: chapterGenerations.id,
      assembledContent: chapterGenerations.assembledContent,
      metadata: chapterGenerations.generationMetadata,
      assemblyMetadata: chapterGenerations.assemblyMetadata,
    })
    .from(chapterGenerations);

  for (const gen of allGens) {
    // Check assembledContent (the main generated chapter/critique/correction text)
    const assembled = gen.assembledContent;
    if (assembled) {
      const hits = checkBlocklist(assembled);
      for (const pattern of hits) {
        findings.push({
          table: "chapter_generations",
          id: gen.id,
          column: "assembledContent",
          pattern: pattern.slice(0, 80),
          snippet: extractSnippet(assembled, pattern),
        });
      }
    }

    // Also check text fields in metadata recursively (JSONB with type labels, etc.)
    const metadata = gen.metadata as Record<string, unknown> | null;
    if (metadata) {
      const texts = extractTextValues(metadata);
      for (const [key, text] of texts) {
        if (!text || text.length < 10) continue;
        const hits = checkBlocklist(text);
        for (const pattern of hits) {
          findings.push({
            table: "chapter_generations",
            id: gen.id,
            column: `metadata.${key}`,
            pattern: pattern.slice(0, 80),
            snippet: extractSnippet(text, pattern),
          });
        }
      }
    }

    // Check assemblyMetadata (raw correction LLM output, pre-extraction)
    const asmMeta = gen.assemblyMetadata as Record<string, unknown> | null;
    if (asmMeta) {
      const texts = extractTextValues(asmMeta);
      for (const [key, text] of texts) {
        if (!text || text.length < 10) continue;
        const hits = checkBlocklist(text);
        for (const pattern of hits) {
          findings.push({
            table: "chapter_generations",
            id: gen.id,
            column: `assemblyMetadata.${key}`,
            pattern: pattern.slice(0, 80),
            snippet: extractSnippet(text, pattern),
          });
        }
      }
    }
  }

  // Report
  if (findings.length === 0) {
    console.log("✅ No se encontró contaminación en la base de datos.");
    console.log(`   Patrones verificados: ${CONTAMINATION_BLOCKLIST.length}`);
    console.log(`   Prompts escaneados: ${allPrompts.length}`);
    console.log(`   Placeholders escaneados: ${allPlaceholders.length}`);
    console.log(`   Generaciones escaneadas: ${allGens.length}`);
    return;
  }

  console.log(`⛔ Se encontraron ${findings.length} ocurrencias de contenido protegido:\n`);

  // Group by table
  const byTable = new Map<string, Finding[]>();
  for (const f of findings) {
    const list = byTable.get(f.table) ?? [];
    list.push(f);
    byTable.set(f.table, list);
  }

  for (const [table, items] of byTable) {
    console.log(`## ${table} (${items.length} hits)`);
    console.log("");
    for (const item of items.slice(0, 20)) {
      console.log(`  ${item.id.slice(0, 12)}... | ${item.column} | ${item.pattern.slice(0, 60)}`);
      console.log(`    → ${item.snippet}`);
    }
    if (items.length > 20) {
      console.log(`  ... y ${items.length - 20} más`);
    }
    console.log("");
  }

  // Per-table summary
  console.log("## Resumen");
  console.log("");
  console.log(`| Tabla                  | Hits |`);
  console.log(`|------------------------|------|`);
  for (const [table, items] of byTable) {
    console.log(`| ${table.padEnd(22)} | ${String(items.length).padStart(4)} |`);
  }
  console.log("");
  console.log(`Patrones más frecuentes:`);
  const patternCounts = new Map<string, number>();
  for (const f of findings) {
    const short = f.pattern.slice(0, 40);
    patternCounts.set(short, (patternCounts.get(short) ?? 0) + 1);
  }
  for (const [pattern, count] of [...patternCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    console.log(`  ${count.toString().padStart(3)} × ${pattern}`);
  }
}

function extractSnippet(text: string, pattern: string, context: number = 30): string {
  try {
    const regex = new RegExp(pattern, "i");
    const match = regex.exec(text);
    if (!match) return text.slice(0, 80);
    const start = Math.max(0, match.index - context);
    const end = Math.min(text.length, match.index + match[0].length + context);
    let snippet = text.slice(start, end);
    if (start > 0) snippet = "..." + snippet;
    if (end < text.length) snippet = snippet + "...";
    return snippet.trim();
  } catch {
    return text.slice(0, 80);
  }
}

function extractTextValues(
  obj: Record<string, unknown>,
  prefix: string = "",
): [string, string][] {
  const results: [string, string][] = [];
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string" && value.length > 10) {
      results.push([fullKey, value]);
    } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      results.push(...extractTextValues(value as Record<string, unknown>, fullKey));
    }
  }
  return results;
}

main().catch((err) => {
  console.error("Error durante el audit:", err);
  process.exit(1);
});
