import { getEncoding } from "js-tiktoken";
import { CHUNK_SIZE_TOKENS, CHUNK_OVERLAP_TOKENS } from "@/lib/constants";

const SEPARATORS = ["\n## ", "\f", "\n\n", "\n", ". ", " ", ""];
const HEADING_PREFIXES = ["#", "##", "###", "####"];

let encoding: ReturnType<typeof getEncoding> | null = null;

function getTokenEncoder() {
  if (!encoding) {
    encoding = getEncoding("cl100k_base");
  }
  return encoding;
}

export function countTokens(text: string): number {
  return getTokenEncoder().encode(text).length;
}

export interface TextChunk {
  content: string;
  tokenCount: number;
  index: number;
  pageNumber: number | null;
  sectionTitle: string | null;
  charStart: number;
  charEnd: number;
}

function locateChunkStart(text: string, chunkText: string, searchFrom: number) {
  const trimmedChunk = chunkText.trim();
  if (!trimmedChunk) {
    return searchFrom;
  }

  const directIndex = text.indexOf(trimmedChunk, searchFrom);
  if (directIndex !== -1) {
    return directIndex;
  }

  const fallbackIndex = text.indexOf(trimmedChunk);
  if (fallbackIndex !== -1) {
    return fallbackIndex;
  }

  return searchFrom;
}

function looksLikeHeading(line: string) {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (HEADING_PREFIXES.some((prefix) => trimmed.startsWith(prefix))) return true;
  if (trimmed.length > 90) return false;

  const words = trimmed.split(/\s+/);
  if (words.length > 12) return false;
  if (/[.!?]$/.test(trimmed)) return false;

  const alphaOnly = trimmed.replace(/[^A-Za-z\s:-]/g, "");
  if (!alphaOnly.trim()) return false;

  const uppercaseRatio =
    alphaOnly.replace(/[^A-Z]/g, "").length / Math.max(alphaOnly.replace(/\s/g, "").length, 1);

  return uppercaseRatio > 0.45 || /^[A-Z0-9][A-Za-z0-9\s:'’-]+$/.test(trimmed);
}

export function inferSectionTitleForOffset(text: string, charStart: number): string | null {
  const forwardContext = text.slice(charStart, Math.min(text.length, charStart + 240));
  const forwardLines = forwardContext
    .split(/\n/)
    .map((line) => line.replace(/\f/g, "").trim())
    .filter(Boolean);

  for (let i = 0; i < Math.min(3, forwardLines.length); i += 1) {
    const line = forwardLines[i];
    if (looksLikeHeading(line)) {
      return line.replace(/^#+\s*/, "").trim();
    }
  }

  const windowStart = Math.max(0, charStart - 1200);
  const context = text.slice(windowStart, charStart);
  const lines = context
    .split(/\n/)
    .map((line) => line.replace(/\f/g, "").trim())
    .filter(Boolean);

  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (looksLikeHeading(line)) {
      return line.replace(/^#+\s*/, "").trim();
    }
  }

  return null;
}

/**
 * Recursive character text splitter.
 * Splits text into chunks of approximately `chunkSizeTokens` tokens
 * with `overlapTokens` token overlap between consecutive chunks.
 */
export function splitText(
  text: string,
  chunkSizeTokens: number = CHUNK_SIZE_TOKENS,
  overlapTokens: number = CHUNK_OVERLAP_TOKENS
): TextChunk[] {
  const chunks: TextChunk[] = [];

  function splitRecursive(text: string, separatorIndex: number): string[] {
    if (separatorIndex >= SEPARATORS.length) {
      return [text];
    }

    const separator = SEPARATORS[separatorIndex];
    const parts = separator ? text.split(separator) : [text];

    const result: string[] = [];
    let current = "";

    for (const part of parts) {
      const candidate = current
        ? current + separator + part
        : part;
      const tokens = countTokens(candidate);

      if (tokens > chunkSizeTokens && current) {
        result.push(current);
        current = part;
      } else if (tokens > chunkSizeTokens && !current) {
        // Single part exceeds chunk size, split with next separator
        const subParts = splitRecursive(part, separatorIndex + 1);
        result.push(...subParts);
      } else {
        current = candidate;
      }
    }

    if (current) {
      result.push(current);
    }

    return result;
  }

  const rawChunks = splitRecursive(text, 0);
  let searchCursor = 0;

  // Incremental page tracking — scans each character at most once instead of
  // re-scanning from index 0 for every chunk (O(n) vs O(n²)).
  let currentPage = 1;
  let lastFormFeedIndex = -1;
  const hasFormFeeds = text.includes("\f");

  // Apply overlap by including trailing text from previous chunk
  for (let i = 0; i < rawChunks.length; i++) {
    const baseChunk = rawChunks[i].trim();
    const charStart = locateChunkStart(text, baseChunk, searchCursor);
    const charEnd = charStart + baseChunk.length;
    searchCursor = charEnd;

    let content = baseChunk;

    if (i > 0 && overlapTokens > 0) {
      const prevChunk = rawChunks[i - 1];
      const prevWords = prevChunk.split(/\s+/);
      // Approximate overlap by taking trailing words from previous chunk
      const overlapWords: string[] = [];
      let overlapTokenCount = 0;
      for (let j = prevWords.length - 1; j >= 0; j--) {
        const wordTokens = countTokens(prevWords[j]);
        if (overlapTokenCount + wordTokens > overlapTokens) break;
        overlapWords.unshift(prevWords[j]);
        overlapTokenCount += wordTokens;
      }
      if (overlapWords.length > 0) {
        content = overlapWords.join(" ") + " " + content;
      }
    }

    // Incrementally count form feeds from the last scanned position to this chunk's start
    if (hasFormFeeds) {
      for (let j = lastFormFeedIndex + 1; j < charStart; j += 1) {
        if (text[j] === "\f") {
          currentPage += 1;
        }
      }
      lastFormFeedIndex = charStart;
    }

    chunks.push({
      content: content.trim(),
      tokenCount: countTokens(content.trim()),
      index: i,
      pageNumber: hasFormFeeds ? currentPage : null,
      sectionTitle: inferSectionTitleForOffset(text, charStart),
      charStart,
      charEnd,
    });
  }

  return chunks;
}
