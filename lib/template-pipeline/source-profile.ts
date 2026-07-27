import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { templateSourceProfiles, templateSourceProfileChunks } from "@/lib/db/schema";
import { sha256Text } from "./hash";
import { executeVersionedPrompt } from "@/lib/prompts/executor";
import { generateEmbeddings, getEmbeddingModel, getEmbeddingDimensions } from "@/lib/ai/embeddings";
import { normalizeText, computeWordShingles } from "@/lib/ai/originality-check";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CHUNK_SIZE = 700;
const CHUNK_OVERLAP = 100;

// ---------------------------------------------------------------------------
// Strict profile schema
// ---------------------------------------------------------------------------

const distinctiveElementSchema = z.object({
  id: z.string().regex(/^risk_[a-z0-9_]+$/),
  kind: z.enum([
    "entity", "number", "formula", "coined_term", "named_framework",
    "metaphor", "anecdote", "example", "creative_sequence",
  ]),
  canonicalLabel: z.string().trim().min(1).max(120),
  aliases: z.array(z.string().trim().min(1).max(120)).max(12),
  sourceChunkIndexes: z.array(z.number().int().nonnegative()).min(1),
  confidence: z.number().min(0).max(1),
  distinctiveness: z.number().min(0).max(1),
}).strict();

export const sourceRiskProfileSchema = z.object({
  elements: z.array(distinctiveElementSchema).max(200),
}).strict();

export type SourceRiskProfile = z.infer<typeof sourceRiskProfileSchema>;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SourceProfileInput {
  pipelineRunId: string;
  chapterId: string;
  bookTemplateId: string;
  title: string;
  contentMd: string;
  profilerRevisionId: string;
  model: string;
}

export interface LexicalFingerprint {
  shingles5: string[];
  shingles8: string[];
}

export interface ProfileChunk {
  chunkIndex: number;
  contentHash: string;
  lexicalFingerprint: LexicalFingerprint;
  embedding: number[];
  tokenCount: number;
}

export interface SourceProfile {
  sourceHash: string;
  sourceLanguage: string;
  profileVersion: string;
  profileHash: string;
  chunks: ProfileChunk[];
  elements: SourceRiskProfile["elements"];
}

// ---------------------------------------------------------------------------
// Text splitting
// ---------------------------------------------------------------------------

export function splitText(text: string, size: number = CHUNK_SIZE, overlap: number = CHUNK_OVERLAP): string[] {
  const words = text.split(/\s+/);
  if (words.length <= size) return [text];

  const chunks: string[] = [];
  let start = 0;
  while (start < words.length) {
    const end = Math.min(start + size, words.length);
    chunks.push(words.slice(start, end).join(" "));
    if (end >= words.length) break;
    start = end - overlap;
    if (start <= 0 || start >= words.length) break;
  }
  return chunks;
}

// ---------------------------------------------------------------------------
// Shingle hashing
// ---------------------------------------------------------------------------

export function hashShingles(text: string, size: 5 | 8): string[] {
  const shingles = [...computeWordShingles(text, size)];
  return shingles.map(sha256Text).sort();
}

// ---------------------------------------------------------------------------
// Source profile builder
// ---------------------------------------------------------------------------

function serializePromptText(source: string): string {
  // Wrap the source in a markdown heading for the LLM prompt
  return `# ${source.slice(0, 50)}...\n\n${source}`;
}

const PROFILE_VERSION = "source-profile-v1";

export async function buildSourceProfile(
  input: SourceProfileInput,
): Promise<SourceProfile> {
  const sourceHash = sha256Text(input.contentMd);
  const chunks = splitText(input.contentMd, CHUNK_SIZE, CHUNK_OVERLAP);

  // Build chunk profiles (hashes + fingerprints, no raw text stored)
  const profileChunks: ProfileChunk[] = chunks.map((content, index) => ({
    chunkIndex: index,
    contentHash: sha256Text(content),
    lexicalFingerprint: {
      shingles5: hashShingles(content, 5),
      shingles8: hashShingles(content, 8),
    },
    embedding: [] as number[], // filled below
    tokenCount: content.split(/\s+/).length,
  }));

  // Generate embeddings (best-effort — semantic originality degrades gracefully
  // with zero vectors when the embedding provider is unavailable).
  // getEmbeddingDimensions() is lazily set by generateEmbeddings → must read after call.
  let embeddingDim = getEmbeddingDimensions();
  try {
    const embeddings = await generateEmbeddings(chunks.map((c) => c));
    embeddingDim = getEmbeddingDimensions(); // now initialized by the call above
    if (embeddings.length !== profileChunks.length) {
      throw new Error(
        `Embedding count mismatch: ${embeddings.length} embeddings for ${profileChunks.length} chunks`,
      );
    }
    for (let i = 0; i < profileChunks.length; i++) {
      if (embeddings[i].length !== embeddingDim) {
        throw new Error(`Chunk ${i} embedding has ${embeddings[i].length} dimensions, expected ${embeddingDim}`);
      }
      profileChunks[i].embedding = embeddings[i];
    }
  } catch (err) {
    console.warn(
      `[source-profile] Embedding generation failed — storing zero vectors. ` +
      `Semantic originality detection will be unavailable for this run. ` +
      `Error: ${err instanceof Error ? err.message : String(err)}`,
    );
    for (const chunk of profileChunks) {
      chunk.embedding = new Array(embeddingDim).fill(0);
    }
  }

  // Invoke profiler with source redaction
  const sourceRiskProfileJsonSchema = JSON.stringify(
    zodToJsonSchema(sourceRiskProfileSchema, { target: "openApi3", $refStrategy: "none" }),
  );

  const { result: profilerResult } = await executeVersionedPrompt({
    stage: "source-profile",
    kind: "source-risk-profiler",
    revisionId: input.profilerRevisionId,
    bookTemplateId: input.bookTemplateId,
    chapterId: input.chapterId,
    markerValues: {
      "{{CAPITULO_FUENTE}}": serializePromptText(input.contentMd),
      "{{OUTPUT_SCHEMA}}": sourceRiskProfileJsonSchema,
    },
    messagePersistence: {
      mode: "redact-sensitive-markers",
      sensitiveMarkers: ["{{CAPITULO_FUENTE}}"],
    },
    model: input.model,
    schema: sourceRiskProfileSchema,
  });

  // Validate profiler output through strict Zod schema
  const parsed = sourceRiskProfileSchema.safeParse(profilerResult.data);
  if (!parsed.success) {
    throw new Error(`Profiler output validation failed: ${parsed.error.message}`);
  }
  const profile = parsed.data;

  // Normalize and validate chunk indexes.
  // LLMs may use 1-based indexing or otherwise overshoot — clamp gracefully.
  const maxIdx = profileChunks.length - 1;
  const normalizedElements = profile.elements.map((element) => {
    const clamped = element.sourceChunkIndexes.map((idx) => {
      if (idx > maxIdx) {
        console.warn(
          `[source-profile] Element ${element.id}: chunkIndex ${idx} clamped to ${maxIdx} (out of range)`,
        );
        return maxIdx;
      }
      return idx;
    });
    return { ...element, sourceChunkIndexes: [...new Set(clamped)] };
  });

  // Compute profileHash from all components
  const profileHash = sha256Text(
    JSON.stringify({
      sourceHash,
      language: "es",
      version: PROFILE_VERSION,
      elements: normalizedElements,
      chunkHashes: profileChunks.map((c) => c.contentHash),
      fingerprints: profileChunks.map((c) => c.lexicalFingerprint),
      embeddingModel: getEmbeddingModel(),
    }),
  );

  return {
    sourceHash,
    sourceLanguage: "es",
    profileVersion: PROFILE_VERSION,
    profileHash,
    chunks: profileChunks,
    elements: normalizedElements,
  };
}

// ---------------------------------------------------------------------------
// Profile persistence
// ---------------------------------------------------------------------------

export async function saveSourceProfile(
  pipelineRunId: string,
  chapterId: string,
  profile: SourceProfile,
): Promise<string> {
  const [row] = await db
    .insert(templateSourceProfiles)
    .values({
      pipelineRunId,
      chapterId,
      sourceHash: profile.sourceHash,
      sourceLanguage: profile.sourceLanguage,
      profileVersion: profile.profileVersion,
      distinctiveElements: profile.elements,
      profileHash: profile.profileHash,
    })
    .onConflictDoUpdate({
      target: [templateSourceProfiles.pipelineRunId, templateSourceProfiles.chapterId],
      set: {
        sourceHash: profile.sourceHash,
        sourceLanguage: profile.sourceLanguage,
        profileVersion: profile.profileVersion,
        distinctiveElements: profile.elements,
        profileHash: profile.profileHash,
      },
    })
    .returning({ id: templateSourceProfiles.id });

  // Replace chunks atomically: delete existing, insert new
  await db
    .delete(templateSourceProfileChunks)
    .where(eq(templateSourceProfileChunks.sourceProfileId, row.id));

  if (profile.chunks.length > 0) {
    try {
      await db.insert(templateSourceProfileChunks).values(
        profile.chunks.map((chunk) => ({
          sourceProfileId: row.id,
          chunkIndex: chunk.chunkIndex,
          contentHash: chunk.contentHash,
          lexicalFingerprint: chunk.lexicalFingerprint,
          embedding: JSON.stringify(chunk.embedding),
          tokenCount: chunk.tokenCount,
        })),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const detail = (err as { detail?: string }).detail ?? "";
      const hint = (err as { hint?: string }).hint ?? "";
      throw new Error(
        `Failed to insert ${profile.chunks.length} source profile chunks: ${msg}` +
        (detail ? `\nDetail: ${detail}` : "") +
        (hint ? `\nHint: ${hint}` : ""),
        { cause: err },
      );
    }
  }

  return row.id;
}
