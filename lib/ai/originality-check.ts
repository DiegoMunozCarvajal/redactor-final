/**
 * Originality detection for generated content.
 *
 * Checks output against known copyrighted works (specifically James Clear's
 * "Atomic Habits" whose chapter files live in `libro-capitulos/`) to prevent
 * the generation pipeline from reproducing distinctive concepts, metaphors,
 * or frameworks from protected source material.
 *
 * Two layers:
 *  1. Blocklist — fast regex patterns for well-known distinctive phrases
 *  2. Shingle similarity — word-level n-gram overlap against source corpus
 *
 * Blocklist runs first (short-circuit). Shingle/LCS only compute if blocklist
 * passes. Corpus fingerprint loads lazily from `libro-capitulos/` and caches
 * in memory. If the corpus directory is missing, the module degrades to
 * blocklist-only mode.
 */

import * as fs from "node:fs";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Blocklist
// ---------------------------------------------------------------------------

/**
 * Regex patterns matching distinctive phrases and concepts from known
 * copyrighted works. These are NOT generic topic words — each pattern
 * identifies a specific creative element that is uniquely associated
 * with a particular author or book.
 *
 * Extend this array to add patterns for additional known works.
 */
export const CONTAMINATION_BLOCKLIST: RegExp[] = [
  // Atomic Habits — central concepts and Spanish variants
  /\bmejora\s+(del|continua\s+del|diaria\s+del)\s*1%/i,
  /\b1%\s+(de\s+)?mejora\b/i,
  /\b1%\s+diari[oa]/i,
  /\bh[aá]bitos\s+at[óo]micos\b/i,
  /\bmet[aá]fora\s+del\s+bamb[uú]\b/i,
  /\bel\s+bamb[uú]\s+(chino|japon[eé]s|que\s+crece)\b/i,
  /\bavi[oó]n\s+(que\s+)?se\s+desv[ií]a\s*(1|un)\s*grado\b/i,
  /\b4\s+leyes\s+del\s+cambio\s+de\s+conducta\b/i,
  /\bcuatro\s+leyes\s+del\s+cambio\b/i,
  /\bciclismo\s+brit[aá]nico\b/i,
  /\bequipo\s+de\s+ciclismo\s+(brit[aá]nico|de\s+Gran\s+Breta[nñ]a)\b/i,
  /\binter[eé]s\s+compuesto\s+(de\s+los\s+|del\s+)?h[aá]bitos?\b/i,
  /\bhielo(?:\s+\p{L}+){0,4}\s+se\s+derrite\b/iu,
  /\bacumulaci[oó]n\s+(de|imperceptible\s+de)\s+peque[ñn][oa]s?\s+mejoras?\b/i,
  /\bsistema\s+por\s+encima\s+de\s+(la\s+)?motivaci[oó]n\b/i,
  /\bvariable\s+que\s+predice\s+la\s+supervivencia\s+de\s+un\s+h[aá]bito\b/i,
  /\bregla\s+de\s+los\s+dos\s+minutos\b/i,
  /\bpeque[ñn]as?\s+ganancias?\s+(diarias?|compuestas?)\b/i,
  /\bh[aá]bitos?\s+clave\b/i,
  /\bacumulaci[oó]n\s+compuesta\b/i,
  /\bplan\s+de\s+implementaci[oó]n\b/i,
  /\bapilamiento\s+de\s+h[aá]bitos\b/i,

  // Atomic Habits — English patterns (DB seeds and old content may have these)
  /\batomic\s+habits\b/i,
  /\bjames\s+clear\b/i,
  /\b1%\s+(better|improvement|daily)\b/i,
  /\b(improve|improvement)\s+(by|of)\s+1%\b/i,
  /\bbamboo\s+(tree|metaphor|grows)\b/i,
  /\b(british|team\s+sky)\s+cycling\b/i,
  /\b4\s+(laws|rules)\s+of\s+behavior\b/i,
  /\bmarginal\s+gains\b/i,
  /\bhabit\s+stacking\b/i,
  /\bkeystone\s+habits?\b/i,
  /\bimplementation\s+intentions?\b/i,
];

/**
 * Check text against the blocklist. Returns the set of matched pattern
 * source strings (the regex `.source` property, for display).
 */
export function checkBlocklist(text: string): string[] {
  if (!text) return [];
  // Normalize: lowercase, strip combining accents for accent-insensitive matching
  const normalized = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

  const hits: string[] = [];
  for (const pattern of CONTAMINATION_BLOCKLIST) {
    if (pattern.test(normalized)) {
      hits.push(pattern.source);
    }
  }
  return hits;
}

// ---------------------------------------------------------------------------
// Text normalization
// ---------------------------------------------------------------------------

/** Normalize text for shingling: lowercase, strip accents, collapse whitespace. */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\w\s]/g, " ") // punctuation → space
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// Word shingles
// ---------------------------------------------------------------------------

/**
 * Compute word-level n-gram shingles from text.
 * Returns a Set of normalized n-word sequences.
 */
export function computeWordShingles(
  text: string,
  n: number = 5,
): Set<string> {
  const words = normalizeText(text).split(/\s+/).filter(w => w.length > 0);
  if (words.length === 0) {
    return new Set<string>();
  }
  if (words.length < n) {
    // Text too short for the requested n-gram size — use all words as one shingle
    return new Set([words.join(" ")]);
  }
  const shingles = new Set<string>();
  for (let i = 0; i <= words.length - n; i++) {
    shingles.add(words.slice(i, i + n).join(" "));
  }
  return shingles;
}

// ---------------------------------------------------------------------------
// Jaccard similarity
// ---------------------------------------------------------------------------

/** Compute Jaccard similarity coefficient between two sets of shingles. */
export function jaccardSimilarity(
  a: Set<string>,
  b: Set<string>,
): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  // Iterate over smaller set for efficiency
  const [smaller, larger] = a.size <= b.size ? [a, b] : [b, a];
  for (const item of smaller) {
    if (larger.has(item)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// ---------------------------------------------------------------------------
// Longest common substring
// ---------------------------------------------------------------------------

/**
 * Find the longest common substring between two normalized texts.
 * Uses dynamic programming O(n*m). Returns the match if >= minLength,
 * otherwise null.
 */
export function longestCommonSubstring(
  a: string,
  b: string,
  minLength: number = 30,
): string | null {
  const na = normalizeText(a);
  const nb = normalizeText(b);
  const m = na.length;
  const n = nb.length;

  let maxLen = 0;
  let endPos = 0;

  // Use two rows to save memory (only need previous row)
  const prev = new Int32Array(n + 1);
  const curr = new Int32Array(n + 1);

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (na[i - 1] === nb[j - 1]) {
        curr[j] = prev[j - 1] + 1;
        if (curr[j] > maxLen) {
          maxLen = curr[j];
          endPos = i;
        }
      } else {
        curr[j] = 0;
      }
    }
    // Swap rows
    prev.set(curr);
    curr.fill(0);
  }

  if (maxLen < minLength) return null;
  return na.substring(endPos - maxLen, endPos);
}

// ---------------------------------------------------------------------------
// Containment score (per-document, not global Jaccard)
// ---------------------------------------------------------------------------

/**
 * Containment score: what fraction of the input text's shingles appear in
 * the corpus document. Uses per-document comparison — not global Jaccard
 * which drowns short excerpts in a 72K+ shingle union.
 *
 * Returns the maximum containment across all documents.
 */
export function containmentScore(
  textShingles: Set<string>,
  corpusDocs: CorpusDocument[],
): number {
  if (textShingles.size === 0 || corpusDocs.length === 0) return 0;
  let maxScore = 0;
  for (const doc of corpusDocs) {
    let intersection = 0;
    for (const s of textShingles) {
      if (doc.shingles5.has(s) || (doc.shingles8?.has(s) ?? false)) intersection++;
    }
    const score = intersection / textShingles.size;
    if (score > maxScore) maxScore = score;
  }
  return maxScore;
}

// ---------------------------------------------------------------------------
// Corpus fingerprint — per-document storage
// ---------------------------------------------------------------------------

export interface CorpusDocument {
  shingles5: Set<string>;
  /** 8-gram shingles. Computed by buildCorpusFingerprint but optional for
   *  synthetic/test corpora that may omit it. */
  shingles8?: Set<string>;
  /** Full normalized text for LCS comparison. */
  text: string;
}

export interface CorpusFingerprint {
  documents: CorpusDocument[];
  totalDocs: number;
  loaded: boolean;
}

let _fingerprint: CorpusFingerprint | null = null;
let _fingerprintLoadAttempted = false;

/**
 * Build a fingerprint from all .md files in the given directory.
 * Stores per-document shingles (5-gram and 8-gram) plus full normalized text
 * for LCS comparison. Per-document containment replaces global Jaccard.
 */
export function buildCorpusFingerprint(
  corpusDir: string,
): CorpusFingerprint {
  try {
    const files = fs.readdirSync(corpusDir).filter((f) => f.endsWith(".md"));
    if (files.length === 0) {
      return { documents: [], totalDocs: 0, loaded: false };
    }

    const documents: CorpusDocument[] = [];
    for (const file of files) {
      const content = fs.readFileSync(path.join(corpusDir, file), "utf-8");
      const normalized = normalizeText(content);
      documents.push({
        shingles5: computeWordShingles(normalized, 5),
        shingles8: computeWordShingles(normalized, 8),
        text: normalized,
      });
    }

    return { documents, totalDocs: files.length, loaded: true };
  } catch {
    return { documents: [], totalDocs: 0, loaded: false };
  }
}

/**
 * Get the corpus fingerprint, loading it lazily from `libro-capitulos/`.
 * Cached in memory after first load. Returns a blocklist-only fingerprint
 * if the corpus directory is missing or unreadable.
 */
export function getCorpusFingerprint(
  corpusDir: string = "libro-capitulos",
): CorpusFingerprint {
  if (_fingerprint) return _fingerprint;
  if (_fingerprintLoadAttempted) {
    return { documents: [], totalDocs: 0, loaded: false };
  }
  _fingerprintLoadAttempted = true;
  _fingerprint = buildCorpusFingerprint(corpusDir);
  return _fingerprint;
}

/** Reset the cached fingerprint (for testing). */
export function resetCorpusFingerprint(): void {
  _fingerprint = null;
  _fingerprintLoadAttempted = false;
}

// ---------------------------------------------------------------------------
// Unified check
// ---------------------------------------------------------------------------

export interface OriginalityResult {
  passed: boolean;
  blocklistHits: string[];
  shingleSimilarity: number;
  lcsMatch: string | null;
  flagged: boolean;
  mode: "blocklist-only" | "full";
}

export interface OriginalityCheckOptions {
  /** Run blocklist check. Default true. */
  blocklist?: boolean;
  /**
   * Per-document containment threshold for flagging.
   * 0.10 = 10% of input shingles found in one document → flag.
   * Default 0.15.
   */
  containmentThreshold?: number;
  /** Minimum LCS length to flag. Default 30. */
  lcsMinLength?: number;
  /** Corpus fingerprint for shingle/LCS checks. Default from getCorpusFingerprint(). */
  corpus?: CorpusFingerprint;
  /** Shingle n-gram size for the checked text. Default 5. */
  shingleN?: number;
}

/**
 * Check text originality against blocklist and source corpus.
 *
 * Short-circuits on blocklist hit (fast regex). Then runs per-document
 * containment scoring (replaces global Jaccard — catches short verbatim
 * excerpts that drown in corpus-wide shingle union). LCS runs independently
 * against full document texts — no similarity gate.
 */
export function checkOriginality(
  text: string,
  options: OriginalityCheckOptions = {},
): OriginalityResult {
  const {
    blocklist: enableBlocklist = true,
    containmentThreshold = 0.15,
    lcsMinLength = 50,
    corpus = getCorpusFingerprint(),
    shingleN = 5,
  } = options;

  // 1. Blocklist (fast, always first)
  const blocklistHits = enableBlocklist ? checkBlocklist(text) : [];
  if (blocklistHits.length > 0) {
    return {
      passed: false,
      blocklistHits,
      shingleSimilarity: 0,
      lcsMatch: null,
      flagged: true,
      mode: corpus.loaded ? "full" : "blocklist-only",
    };
  }

  // 2. If corpus unavailable, done (blocklist-only mode)
  if (!corpus.loaded || corpus.documents.length === 0) {
    return {
      passed: true,
      blocklistHits: [],
      shingleSimilarity: 0,
      lcsMatch: null,
      flagged: false,
      mode: "blocklist-only",
    };
  }

  // 3. Per-document containment (replaces global Jaccard).
  // Each document scored independently → max across all docs.
  // Short verbatim excerpts (~100 words) in long docs now register
  // instead of drowning in a 72K+ shingle union.
  const textShingles = computeWordShingles(text, shingleN);
  const containment = containmentScore(textShingles, corpus.documents);

  if (containment > containmentThreshold) {
    return {
      passed: false,
      blocklistHits: [],
      shingleSimilarity: containment,
      lcsMatch: null,
      flagged: true,
      mode: "full",
    };
  }

  // 4. LCS against full document texts.
  // Gate per-doc: only run LCS when there's at least trace shingle overlap
  // (>0 containment) against that specific document. Clean text with zero
  // overlap → skip LCS entirely. Avoids O(n×m) scan on every unrelated doc.
  for (const doc of corpus.documents) {
    // Fast pre-check: does this doc share any shingles with the text?
    let overlap = 0;
    for (const s of textShingles) {
      if (doc.shingles5.has(s) || (doc.shingles8?.has(s) ?? false)) overlap++;
    }
    if (overlap === 0) continue; // zero overlap → LCS can't match, skip

    const lcs = longestCommonSubstring(text, doc.text, lcsMinLength);
    if (lcs) {
      return {
        passed: false,
        blocklistHits: [],
        shingleSimilarity: containment,
        lcsMatch: lcs,
        flagged: true,
        mode: "full",
      };
    }
  }

  return {
    passed: true,
    blocklistHits: [],
    shingleSimilarity: containment,
    lcsMatch: null,
    flagged: false,
    mode: "full",
  };
}

/**
 * Build a user-facing message describing what contamination was found,
 * for use in retry prompts. Does NOT name the source book.
 */
export function contaminationMessage(result: OriginalityResult): string {
  const parts: string[] = [];
  if (result.blocklistHits.length > 0) {
    parts.push(
      `Conceptos detectados que coinciden con material protegido: ${result.blocklistHits.length} patrón(es).`,
    );
  }
  if (result.shingleSimilarity > 0) {
    parts.push(
      `Similitud textual con corpus protegido: ${(result.shingleSimilarity * 100).toFixed(1)}%.`,
    );
  }
  if (result.lcsMatch) {
    parts.push(
      `Subcadena común detectada (longitud > 30 caracteres).`,
    );
  }
  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// Pipeline-stage-aware originality assertion (fail-closed by default)
// ---------------------------------------------------------------------------

export type PipelineStage =
  | "metaprompt-block"
  | "placeholder-def"
  | "fragment"
  | "assembly"
  | "correction"
  | "critique";

/** Map stage to detection thresholds. metaprompt-block/critique use blocklist-only. */
function thresholdsForStage(stage: PipelineStage): OriginalityCheckOptions {
  switch (stage) {
    case "metaprompt-block":
      return { containmentThreshold: 1.0, lcsMinLength: 999 };
    case "placeholder-def":
      return { containmentThreshold: 0.15, lcsMinLength: 30, shingleN: 5 };
    case "fragment":
      return { containmentThreshold: 0.10, lcsMinLength: 40, shingleN: 8 };
    case "assembly":
      return { containmentThreshold: 0.08, lcsMinLength: 50, shingleN: 8 };
    case "correction":
      return { containmentThreshold: 0.08, lcsMinLength: 50, shingleN: 8 };
    case "critique":
      return { containmentThreshold: 1.0, lcsMinLength: 999 };
  }
}

export class OriginalityError extends Error {
  constructor(
    public result: OriginalityResult,
    public stage: PipelineStage,
  ) {
    super(
      `Contenido no original detectado en ${stage}: ${contaminationMessage(result)}`,
    );
    this.name = "OriginalityError";
  }
}

export interface AssertOriginalityOptions {
  stage: PipelineStage;
  /** If true, throws OriginalityError on failure. Default true for metaprompt-block and placeholder-def. */
  throwOnFail?: boolean;
}

/**
 * Check text originality with stage-appropriate thresholds.
 * Throws OriginalityError by default for critical stages (metaprompt-block, placeholder-def).
 * Returns result for advisory stages (fragment, assembly, correction, critique).
 */
export function assertOriginalEnough(
  text: string,
  options: AssertOriginalityOptions,
): OriginalityResult {
  const thresholds = thresholdsForStage(options.stage);
  const result = checkOriginality(text, thresholds);
  const shouldThrow =
    options.throwOnFail !== undefined
      ? options.throwOnFail
      : options.stage === "metaprompt-block" || options.stage === "placeholder-def";
  if (!result.passed) {
    if (shouldThrow) {
      throw new OriginalityError(result, options.stage);
    }
    // Non-blocking stages: log warning so contamination is visible in logs
    // even though execution continues.
    console.warn(
      `[originality-check] ⚠️  ${options.stage}: ${contaminationMessage(result)}`,
    );
  }
  return result;
}
