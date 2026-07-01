/**
 * Sanitize error messages for safe logging/storage.
 * Redacts common secret patterns, PII, and SQL before truncation.
 */
export function sanitizeError(err: unknown): string {
  let message = err instanceof Error ? err.message : "Unknown error";
  // Include cause (e.g. Drizzle wraps PostgreSQL errors — real error is in .cause)
  if (err instanceof Error && err.cause instanceof Error) {
    message = `${message} [cause: ${err.cause.message}]`;
  }
  // Redact common secret patterns, SQL fragments, and PII before truncation
  const redacted = message
    // API keys and tokens
    .replace(/sk-[a-zA-Z0-9]{24,}/g, "sk-***")
    .replace(/Bearer\s+[a-zA-Z0-9_\-.]{20,}/g, "Bearer ***")
    .replace(/ghp_[a-zA-Z0-9]{36}/g, "ghp_***")
    .replace(/gho_[a-zA-Z0-9]{36}/g, "gho_***")
    // URLs with credentials — must run BEFORE email redaction.
    // Email regex would match `user@host.com` inside `postgres://user:pass@host.com/db`,
    // consuming the `@` that the credential-URL regex needs to match.
    .replace(/[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^@\s]+@/g, "***://***@")
    // Email addresses
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, "[email redacted]")
    // SQL fragments (Drizzle may include raw SQL in error messages)
    .replace(/\b(SELECT|INSERT|UPDATE|DELETE|CREATE|DROP|ALTER)\b\s+.*?(?:;|FROM|INTO|SET|TABLE)/gi, "[SQL redacted]");
  return redacted.slice(0, 2000);
}
