/**
 * CLI: Clone a legacy project onto a clean template.
 *
 * Usage:
 *   pnpm clone:project-to-clean-template \
 *     --project-id <uuid> \
 *     --template-id <uuid> \
 *     --operation-id <uuid> \
 *     --legacy-project-state-hash <sha256> \
 *     --clean-template-artifact-set-hash <sha256> \
 *     [--dry-run]
 *
 * All UUIDs and hashes are required.  --dry-run validates without writing.
 * Exits 0 on success, 1 on error.
 */

import { executeProjectClone, CloneValidationError } from "@/lib/remediation/clone-project";

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);

function parseArg(name: string): string | undefined {
  const idx = args.indexOf(name);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

function hasFlag(name: string): boolean {
  return args.includes(name);
}

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------

if (hasFlag("--help") || hasFlag("-h")) {
  console.log(`
Clone a legacy project onto a clean template.

Usage:
  pnpm clone:project-to-clean-template -- --project-id <uuid> --template-id <uuid> --operation-id <uuid> --legacy-project-state-hash <sha256> --clean-template-artifact-set-hash <sha256> [--dry-run]

Options:
  --project-id                       Legacy project UUID (required)
  --template-id                      Clean template UUID (required)
  --operation-id                     Unique operation UUID (required)
  --legacy-project-state-hash        SHA-256 hash of legacy project state (required)
  --clean-template-artifact-set-hash SHA-256 hash of clean template artifact set (required)
  --dry-run                          Validate only, no writes
  --help, -h                         Show this help
`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Validate
// ---------------------------------------------------------------------------

const projectId = parseArg("--project-id");
const templateId = parseArg("--template-id");
const operationId = parseArg("--operation-id");
const legacyProjectStateHash = parseArg("--legacy-project-state-hash");
const cleanTemplateArtifactSetHash = parseArg("--clean-template-artifact-set-hash");
const dryRun = hasFlag("--dry-run");

const errors: string[] = [];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_RE = /^[0-9a-f]{64}$/i;

if (!projectId) {
  errors.push("--project-id is required");
} else if (!UUID_RE.test(projectId)) {
  errors.push(`--project-id is not a valid UUID: ${projectId}`);
}

if (!templateId) {
  errors.push("--template-id is required");
} else if (!UUID_RE.test(templateId)) {
  errors.push(`--template-id is not a valid UUID: ${templateId}`);
}

if (!operationId) {
  errors.push("--operation-id is required");
} else if (!UUID_RE.test(operationId)) {
  errors.push(`--operation-id is not a valid UUID: ${operationId}`);
}

if (!legacyProjectStateHash) {
  errors.push("--legacy-project-state-hash is required");
} else if (!SHA256_RE.test(legacyProjectStateHash)) {
  errors.push("--legacy-project-state-hash is not a valid SHA-256 hex string");
}

if (!cleanTemplateArtifactSetHash) {
  errors.push("--clean-template-artifact-set-hash is required");
} else if (!SHA256_RE.test(cleanTemplateArtifactSetHash)) {
  errors.push("--clean-template-artifact-set-hash is not a valid SHA-256 hex string");
}

if (errors.length > 0) {
  for (const err of errors) {
    console.error(`ERROR: ${err}`);
  }
  console.error("\nUse --help for usage information.");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Execute
// ---------------------------------------------------------------------------

async function main() {
  try {
    const result = await executeProjectClone({
      operationId: operationId!,
      legacyProjectId: projectId!,
      cleanTemplateId: templateId!,
      legacyProjectStateHash: legacyProjectStateHash!,
      cleanTemplateArtifactSetHash: cleanTemplateArtifactSetHash!,
      dryRun,
    });

    if (dryRun) {
      console.log("Dry-run passed. No writes performed.");
    } else {
      console.log(
        JSON.stringify(
          {
            status: "ok",
            newProjectId: result.newProjectId,
            operationId: result.operationId,
          },
          null,
          2,
        ),
      );
    }

    process.exit(0);
  } catch (err: unknown) {
    if (err instanceof CloneValidationError) {
      console.error(`ERROR: ${err.message}`);
    } else if (err instanceof Error) {
      console.error(`ERROR: ${err.message}`);
      if (err.stack) {
        console.error(err.stack);
      }
    } else {
      console.error("ERROR:", err);
    }
    process.exit(1);
  }
}

main();
