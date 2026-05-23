/**
 * Sanitize error messages for safe logging/storage.
 * Redacts common secret patterns and truncates to 500 characters.
 */
export function sanitizeError(err: unknown): string {
  const message = err instanceof Error ? err.message : "Unknown error";
  // Redact common secret patterns before truncation
  const redacted = message
    .replace(/sk-[a-zA-Z0-9]{24,}/g, "sk-***")
    .replace(/Bearer\s+[a-zA-Z0-9_\-.]{20,}/g, "Bearer ***")
    .replace(/ghp_[a-zA-Z0-9]{36}/g, "ghp_***")
    .replace(/gho_[a-zA-Z0-9]{36}/g, "gho_***");
  return redacted.slice(0, 500);
}
