/**
 * Audit templates for contamination using lineage classification.
 *
 * Classifies each template into one of: clean_v2 / legacy_unverified / suspect / contaminated
 * Prints counts and hashes only — never snippets, labels, regex patterns, or source text.
 *
 * Usage:
 *   tsx scripts/audit-contamination.ts --dry-run
 *   tsx scripts/audit-contamination.ts --dry-run --template-id <UUID>
 *   tsx scripts/audit-contamination.ts --dry-run --json
 *   tsx scripts/audit-contamination.ts --dry-run --template-id <UUID> --json
 *
 * Flags:
 *   --dry-run       Required (read-only safety check — explicit intent)
 *   --template-id   UUID of a single template to audit (omit to audit all)
 *   --json          Output as JSON array instead of table
 */

import { auditTemplate, auditAllTemplates } from "../lib/remediation/audit";
import type { SafeAuditReport } from "../lib/remediation/audit";

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

interface CliArgs {
  dryRun: boolean;
  templateId: string | null;
  json: boolean;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);

  const dryRun = args.includes("--dry-run");
  const templateId = (() => {
    const idx = args.indexOf("--template-id");
    return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : null;
  })();
  const json = args.includes("--json");

  if (!dryRun) {
    console.error("Error: --dry-run is required (read-only safety check)");
    process.exit(1);
  }

  return { dryRun, templateId, json };
}

// ---------------------------------------------------------------------------
// Table formatter
// ---------------------------------------------------------------------------

function formatTable(reports: SafeAuditReport[]): string {
  const lines: string[] = [];

  // Header
  lines.push(
    `${"template_id".padEnd(38)} | ${"name".padEnd(24)} | ${"classification".padEnd(18)} | ${"pipeline".padEnd(22)} | ${"source".padEnd(6)} | projects | gens | action`,
  );
  lines.push("─".repeat(150));

  // Rows
  for (const r of reports) {
    const src = r.sourceFilesAvailable ? "yes" : "no";
    lines.push(
      `${r.templateId.padEnd(38)} | ${r.templateName.slice(0, 22).padEnd(22)} | ${r.classification.padEnd(16)} | ${(r.pipelineVersion ?? "-").slice(0, 20).padEnd(20)} | ${src.padEnd(4)} | ${String(r.projectCount).padEnd(5)} | ${String(r.generationCount).padEnd(2)} | ${r.recommendedAction}`,
    );
  }

  return lines.join("\n");
}

function printSummary(reports: SafeAuditReport[]): void {
  const counts: Record<string, number> = {};
  for (const r of reports) {
    counts[r.classification] = (counts[r.classification] ?? 0) + 1;
  }

  console.log("\nSummary:");
  for (const [c, n] of Object.entries(counts).sort()) {
    console.log(`  ${c.padEnd(20)} ${n}`);
  }
  console.log(`  ${"total".padEnd(20)} ${reports.length}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs();

  const reports: SafeAuditReport[] = args.templateId
    ? [await auditTemplate(args.templateId)]
    : await auditAllTemplates();

  if (args.json) {
    console.log(JSON.stringify(reports, null, 2));
  } else {
    console.log(formatTable(reports));
    printSummary(reports);
  }
}

main().catch((err: Error) => {
  console.error("Audit failed:", err.message);
  process.exit(1);
});
