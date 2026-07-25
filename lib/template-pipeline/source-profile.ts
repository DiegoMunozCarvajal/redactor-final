import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { sha256Text } from "./hash";
import { executeVersionedPrompt } from "@/lib/prompts/executor";
import { generateEmbeddings, EMBEDDING_MODEL } from "@/lib/ai/embeddings";
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

  // Generate embeddings
  const embeddings = await generateEmbeddings(chunks.map((c) => c));
  if (embeddings.length !== profileChunks.length) {
    throw new Error(
      `Embedding count mismatch: ${embeddings.length} embeddings for ${profileChunks.length} chunks`,
    );
  }
  for (let i = 0; i < profileChunks.length; i++) {
    if (embeddings[i].length !== 1536) {
      throw new Error(`Chunk ${i} embedding has ${embeddings[i].length} dimensions, expected 1536`);
    }
    profileChunks[i].embedding = embeddings[i];
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

  // Validate chunk indexes
  for (const element of profile.elements) {
    for (const idx of element.sourceChunkIndexes) {
      if (idx >= profileChunks.length) {
        throw new Error(
          `Element ${element.id}: chunkIndex ${idx} out of range (max ${profileChunks.length - 1})`,
        );
      }
    }
  }

  // Compute profileHash from all components
  const profileHash = sha256Text(
    JSON.stringify({
      sourceHash,
      language: "es",
      version: PROFILE_VERSION,
      elements: profile.elements,
      chunkHashes: profileChunks.map((c) => c.contentHash),
      fingerprints: profileChunks.map((c) => c.lexicalFingerprint),
      embeddingModel: EMBEDDING_MODEL,
    }),
  );

  return {
    sourceHash,
    sourceLanguage: "es",
    profileVersion: PROFILE_VERSION,
    profileHash,
    chunks: profileChunks,
    elements: profile.elements,
  };
}
