#!/usr/bin/env tsx
/**
 * CLI for template regeneration.
 *
 * Usage:
 *   rtk pnpm regenerate:template -- --template-id <uuid> --source-dir <path> --operation-id <uuid> [options]
 *   rtk pnpm regenerate:template -- --template-id <uuid> --allow-execution-source --operation-id <uuid> [options]
 */

import { executeTemplateRegeneration } from "@/lib/remediation/regenerate-template";
import type { PlanRegenerationInput } from "@/lib/remediation/regenerate-template";

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------

function printUsage(): void {
  console.error(`
Usage:
  regenerate:template --template-id <uuid> --source-dir <path> --operation-id <uuid> [options]
  regenerate:template --template-id <uuid> --allow-execution-source --operation-id <uuid> [options]

Required (exactly one of):
  --source-dir <path>              Directory containing .md source files (one per chapter)
  --allow-execution-source         Use historical execution messages instead of source files

Required:
  --template-id <uuid>             Legacy template ID to regenerate
  --operation-id <uuid>            Unique operation ID (use uuidgen)

Required for validation:
  --rhetoric-trace-revision <uuid> Prompt revision ID for rhetoric trace classification
  --source-profiler-revision <uuid> Prompt revision ID for source profiling

Optional:
  --dry-run                        Validate and plan without performing writes
  --help                           Show this message
  `);
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs(): PlanRegenerationInput & { _showHelp?: boolean } {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes("--help")) {
    printUsage();
    process.exit(args.includes("--help") ? 0 : 1);
  }

  let templateId = "";
  let operationId = "";
  let rhetoricTraceRevisionId = "";
  let sourceProfilerRevisionId = "";
  let sourceDir: string | undefined;
  let allowExecutionSource = false;
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    const next = (label: string): string => {
      const val = args[++i];
      if (!val || val.startsWith("-")) {
        console.error(`Error: ${label} requires a value`);
        process.exit(1);
      }
      return val;
    };

    switch (arg) {
      case "--template-id":
        templateId = next("--template-id");
        break;
      case "--source-dir":
        sourceDir = next("--source-dir");
        break;
      case "--operation-id":
        operationId = next("--operation-id");
        break;
      case "--rhetoric-trace-revision":
        rhetoricTraceRevisionId = next("--rhetoric-trace-revision");
        break;
      case "--source-profiler-revision":
        sourceProfilerRevisionId = next("--source-profiler-revision");
        break;
      case "--allow-execution-source":
        allowExecutionSource = true;
        break;
      case "--dry-run":
        dryRun = true;
        break;
      default:
        if (arg.startsWith("-")) {
          console.error(`Error: Unknown option ${arg}`);
          printUsage();
          process.exit(1);
        }
    }
  }

  // Validate required args
  if (!templateId) {
    console.error("Error: --template-id is required");
    process.exit(1);
  }
  if (!operationId) {
    console.error("Error: --operation-id is required");
    process.exit(1);
  }

  // Validate source mode
  const hasSourceDir = typeof sourceDir === "string" && sourceDir.length > 0;
  if (!hasSourceDir && !allowExecutionSource) {
    console.error("Error: Either --source-dir or --allow-execution-source is required");
    process.exit(1);
  }
  if (hasSourceDir && allowExecutionSource) {
    console.error("Error: Cannot provide both --source-dir and --allow-execution-source");
    process.exit(1);
  }

  // Validate UUIDs
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const checkUuid = (val: string, label: string): void => {
    if (!val) {
      console.error(`Error: ${label} is required`);
      process.exit(1);
    }
    if (!uuidRe.test(val)) {
      console.error(`Error: Invalid ${label}: ${val}`);
      process.exit(1);
    }
  };
  checkUuid(templateId, "--template-id");
  checkUuid(operationId, "--operation-id");
  checkUuid(rhetoricTraceRevisionId, "--rhetoric-trace-revision");
  checkUuid(sourceProfilerRevisionId, "--source-profiler-revision");

  return {
    operationId,
    legacyTemplateId: templateId,
    rhetoricTraceRevisionId,
    sourceProfilerRevisionId,
    sourceDir,
    allowExecutionSource,
    dryRun,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const input = parseArgs();

  const result = await executeTemplateRegeneration(input);

  if (result.templateId && result.pipelineRunId) {
    console.log(
      JSON.stringify(
        {
          templateId: result.templateId,
          pipelineRunId: result.pipelineRunId,
          operationId: result.operationId,
        },
        null,
        2,
      ),
    );
  } else if (input.dryRun) {
    console.log("Dry-run: validation passed, no writes performed.");
  } else {
    console.log("Operation is running or pending. No template created yet.");
  }

  process.exit(0);
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`Error: ${message}`);
  process.exit(1);
});
