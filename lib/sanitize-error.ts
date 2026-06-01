/**
 * Sanitize error messages for safe logging/storage.
 * Redacts common secret patterns and truncates to 500 characters.
 */
export function sanitizeError(err: unknown): string {
  let message = err instanceof Error ? err.message : "Unknown error";
  // Include cause (e.g. Drizzle wraps PostgreSQL errors — real error is in .cause)
  if (err instanceof Error && err.cause instanceof Error) {
    message = `${message} [cause: ${err.cause.message}]`;
  }
  // Redact common secret patterns before truncation
  const redacted = message
    .replace(/sk-[a-zA-Z0-9]{24,}/g, "sk-***")
    .replace(/Bearer\s+[a-zA-Z0-9_\-.]{20,}/g, "Bearer ***")
    .replace(/ghp_[a-zA-Z0-9]{36}/g, "ghp_***")
    .replace(/gho_[a-zA-Z0-9]{36}/g, "gho_***");
  return redacted.slice(0, 500);
}
