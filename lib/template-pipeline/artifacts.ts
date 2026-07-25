import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  templateRunArtifacts,
  templatePipelineRuns,
  bookTemplates,
  prompts,
  chapterPlaceholders,
} from "@/lib/db/schema";
import { sha256Canonical } from "./hash";
import type { TraceIr } from "./trace-ir";
import type { CompiledBlock } from "./compiler";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ArtifactIdentity {
  pipelineRunId: string;
  chapterId: string;
  sourceHash: string;
  rhetoricRevisionId: string;
  compilerHash: string;
}

export interface SaveArtifactInput {
  pipelineRunId: string;
  chapterId: string;
  traceIr: TraceIr;
  compiledTemplate: CompiledBlock[];
  artifactHash: string;
}

// ---------------------------------------------------------------------------
// Idempotent artifact lookup
// ---------------------------------------------------------------------------

export async function findReusableArtifact(
  identity: ArtifactIdentity,
): Promise<{ id: string; artifactHash: string } | null> {
  const [existing] = await db
    .select({ id: templateRunArtifacts.id, artifactHash: templateRunArtifacts.artifactHash })
    .from(templateRunArtifacts)
    .where(
      and(
        eq(templateRunArtifacts.pipelineRunId, identity.pipelineRunId),
        eq(templateRunArtifacts.chapterId, identity.chapterId),
      ),
    )
    .limit(1);

  if (!existing) return null;

  // Identity tuple must match exactly
  const validationReport = await db
    .select({ validationReport: templateRunArtifacts.validationReport })
    .from(templateRunArtifacts)
    .where(eq(templateRunArtifacts.id, existing.id))
    .limit(1);

  const storedIdentity = (validationReport[0]?.validationReport as Record<string, unknown>)?.identity as Record<string, string> | undefined;
  const identityMatch = storedIdentity
    && storedIdentity.sourceHash === identity.sourceHash
    && storedIdentity.rhetoricRevisionId === identity.rhetoricRevisionId
    && storedIdentity.compilerHash === identity.compilerHash;

  return identityMatch ? existing : null;
}

// ---------------------------------------------------------------------------
// Save artifact (upsert)
// ---------------------------------------------------------------------------

export async function saveRunArtifact(
  input: SaveArtifactInput,
): Promise<{ id: string }> {
  const identityHash = sha256Canonical({
    pipelineRunId: input.pipelineRunId,
    chapterId: input.chapterId,
  });

  const [artifact] = await db
    .insert(templateRunArtifacts)
    .values({
      pipelineRunId: input.pipelineRunId,
      chapterId: input.chapterId,
      traceIr: input.traceIr as unknown as Record<string, unknown>,
      compiledTemplate: input.compiledTemplate as unknown as Record<string, unknown>[],
      artifactHash: input.artifactHash,
      validationReport: {
        identity: {
          pipelineRunId: input.pipelineRunId,
          chapterId: input.chapterId,
          identityHash,
        },
      },
    })
    .onConflictDoUpdate({
      target: [templateRunArtifacts.pipelineRunId, templateRunArtifacts.chapterId],
      set: {
        traceIr: input.traceIr as unknown as Record<string, unknown>,
        compiledTemplate: input.compiledTemplate as unknown as Record<string, unknown>[],
        artifactHash: input.artifactHash,
      },
    })
    .returning();

  return artifact;
}

// ---------------------------------------------------------------------------
// Atomic finalization
// ---------------------------------------------------------------------------

export async function finalizeTemplateRun(
  runId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    // Lock and validate run state
    const [run] = await tx
      .select({
        id: templatePipelineRuns.id,
        status: templatePipelineRuns.status,
        bookTemplateId: templatePipelineRuns.bookTemplateId,
      })
      .from(templatePipelineRuns)
      .where(eq(templatePipelineRuns.id, runId))
      .limit(1);

    if (!run) throw new Error(`Run ${runId} not found`);
    if (run.status === "clean") return; // already finalized, idempotent

    if (run.status !== "running") {
      throw new Error(`Run ${runId} is not running (status: ${run.status})`);
    }

    // Load all artifacts for this run
    const artifacts = await tx
      .select()
      .from(templateRunArtifacts)
      .where(eq(templateRunArtifacts.pipelineRunId, runId));

    if (artifacts.length === 0) {
      throw new Error(`No artifacts found for run ${runId}`);
    }

    // Insert compiled prompts for each artifact
    for (const artifact of artifacts) {
      const compiled = artifact.compiledTemplate as unknown as CompiledBlock[];

      for (let i = 0; i < compiled.length; i++) {
        const block = compiled[i];
        const [inserted] = await tx
          .insert(prompts)
          .values({
            chapterId: artifact.chapterId,
            position: i,
            isAssembly: false,
            title: block.name,
            content: block.content,
            userPrompt: block.userPrompt,
            function: block.function ?? null,
            notes: (block.notes as string | null) ?? null,
            sourceContext: (block.sourceContext as string | null) ?? null,
            templatePipelineRunId: runId,
            templateArtifactHash: artifact.artifactHash,
          })
          .returning({ id: prompts.id });

        // Insert placeholders for this prompt
        if (block.placeholders.length > 0) {
          // Deduplicate by name across blocks in this chapter
          const seen = new Map<string, { name: string; function: string; dependsOn: string[] }>();
          for (const ph of block.placeholders) {
            const existing = seen.get(ph.name);
            if (!existing) {
              seen.set(ph.name, {
                name: ph.name,
                function: ph.function,
                dependsOn: ph.dependsOn,
              });
            }
          }

          for (const [, ph] of seen) {
            await tx
              .insert(chapterPlaceholders)
              .values({
                chapterId: artifact.chapterId,
                name: ph.name,
                function: ph.function,
                templatePipelineRunId: runId,
                templateArtifactHash: artifact.artifactHash,
                dependencyNames: ph.dependsOn,
              })
              .onConflictDoUpdate({
                target: [chapterPlaceholders.chapterId, chapterPlaceholders.name],
                set: {
                  function: ph.function,
                  templatePipelineRunId: runId,
                  templateArtifactHash: artifact.artifactHash,
                  dependencyNames: ph.dependsOn,
                },
              });
          }
        }
      }
    }

    // Mark run clean
    await tx
      .update(templatePipelineRuns)
      .set({ status: "clean", completedAt: new Date() })
      .where(eq(templatePipelineRuns.id, runId));

    // Activate template
    await tx
      .update(bookTemplates)
      .set({ activePipelineRunId: runId, status: "ready" })
      .where(eq(bookTemplates.id, run.bookTemplateId));
  });
}
