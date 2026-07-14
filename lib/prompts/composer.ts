import { createHash } from 'node:crypto';
import { RUNTIME_MARKER_RE } from './contracts';

export interface ComposeInput {
  systemTemplate: string;
  userTemplate: string;
  requiredMarkers: string[];
}

export interface ComposedPrompt {
  systemMessage: string;
  userMessage: string;
  dataManifest: Record<string, { sha256: string; chars: number }>;
}

export function composePrompt(
  revision: ComposeInput,
  markerValues: Record<string, string>,
): ComposedPrompt {
  let systemMessage = revision.systemTemplate;
  let userMessage = revision.userTemplate;

  // 1. Validate and apply replacements for required markers
  for (const marker of revision.requiredMarkers) {
    const value = markerValues[marker];
    if (value === undefined) {
      throw new Error(`Missing marker value ${marker}`);
    }
    systemMessage = systemMessage.split(marker).join(value);
    userMessage = userMessage.split(marker).join(value);
  }

  // 2. Check for any remaining runtime markers (catches values containing marker-like strings)
  const combined = `${systemMessage}\n${userMessage}`;
  const remaining = combined.match(RUNTIME_MARKER_RE);
  if (remaining !== null) {
    // Deduplicate and sort for deterministic error messages
    const unique = [...new Set(remaining)].sort();
    throw new Error(`Unresolved runtime marker ${unique[0]}`);
  }

  // 3. Build data manifest (sha256 hashes, no values)
  const dataManifest: Record<string, { sha256: string; chars: number }> = {};
  for (const marker of revision.requiredMarkers) {
    const value = markerValues[marker]!;
    const hash = createHash('sha256').update(value).digest('hex');
    dataManifest[marker] = { sha256: hash, chars: value.length };
  }

  return { systemMessage, userMessage, dataManifest };
}
