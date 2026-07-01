import { describe, it, expect } from "vitest";
import { sanitizeError } from "@/lib/sanitize-error";

describe("sanitizeError", () => {
  // ---------------------------------------------------------------------------
  // Basic input types
  // ---------------------------------------------------------------------------

  it("returns 'Unknown error' for non-Error input", () => {
    expect(sanitizeError(null)).toBe("Unknown error");
    expect(sanitizeError(undefined)).toBe("Unknown error");
    expect(sanitizeError(42)).toBe("Unknown error");
    expect(sanitizeError("plain string")).toBe("Unknown error");
    expect(sanitizeError({})).toBe("Unknown error");
  });

  it("returns the message of an Error instance", () => {
    expect(sanitizeError(new Error("something broke"))).toBe("something broke");
  });

  // ---------------------------------------------------------------------------
  // API key and token redaction
  // ---------------------------------------------------------------------------

  it("redacts OpenAI-style sk- keys", () => {
    const msg = "Error with key sk-abc123def456ghi789jkl012mno345pqr678stu";
    expect(sanitizeError(new Error(msg))).toContain("sk-***");
    expect(sanitizeError(new Error(msg))).not.toContain("abc123");
  });

  it("redacts short sk- keys (24 chars minimum)", () => {
    // 24-char key should be redacted
    const msg24 = "key: sk-abcdefghijklmnopqrstuvwx";
    expect(sanitizeError(new Error(msg24))).toContain("sk-***");
  });

  it("does NOT redact sk- strings under 24 chars", () => {
    const msg = "key: sk-short";
    expect(sanitizeError(new Error(msg))).toBe("key: sk-short");
  });

  it("redacts Bearer tokens", () => {
    const msg = "Auth: Bearer eyJhbGciOiJIUzI1NiJ9.abcdefghij";
    const result = sanitizeError(new Error(msg));
    expect(result).toContain("Bearer ***");
    expect(result).not.toContain("eyJhbGci");
  });

  it("redacts GitHub personal access tokens (ghp_)", () => {
    const msg = "token: ghp_abcdefghijklmnopqrstuvwxyz1234567890";
    const result = sanitizeError(new Error(msg));
    expect(result).toContain("ghp_***");
    expect(result).not.toContain("abcdef");
  });

  it("redacts GitHub OAuth tokens (gho_)", () => {
    const msg = "token: gho_abcdefghijklmnopqrstuvwxyz1234567890";
    const result = sanitizeError(new Error(msg));
    expect(result).toContain("gho_***");
    expect(result).not.toContain("abcdef");
  });

  // ---------------------------------------------------------------------------
  // SQL fragment redaction
  // ---------------------------------------------------------------------------

  it("redacts SQL SELECT statements", () => {
    const msg = 'error: relation "users" does not exist. Query: SELECT * FROM users WHERE id = $1;';
    const result = sanitizeError(new Error(msg));
    expect(result).toContain("[SQL redacted]");
    expect(result).not.toContain("SELECT");
  });

  it("redacts SQL INSERT statements", () => {
    const msg = "INSERT INTO projects (id, name) VALUES ($1, $2)";
    expect(sanitizeError(new Error(msg))).toContain("[SQL redacted]");
  });

  it("redacts SQL UPDATE statements", () => {
    const msg = "UPDATE chapter_generations SET status = $1 WHERE id = $2";
    expect(sanitizeError(new Error(msg))).toContain("[SQL redacted]");
  });

  it("redacts SQL DELETE statements", () => {
    const msg = "DELETE FROM prompts WHERE id = $1";
    expect(sanitizeError(new Error(msg))).toContain("[SQL redacted]");
  });

  // ---------------------------------------------------------------------------
  // Email redaction
  // ---------------------------------------------------------------------------

  it("redacts email addresses", () => {
    const msg = "user admin@example.com not found";
    const result = sanitizeError(new Error(msg));
    expect(result).toContain("[email redacted]");
    expect(result).not.toContain("admin@example.com");
  });

  it("redacts multiple email addresses", () => {
    const msg = "cc: alice@foo.com, bob@bar.co";
    const result = sanitizeError(new Error(msg));
    // Both emails should be redacted
    const matches = (result.match(/\[email redacted\]/g) ?? []).length;
    expect(matches).toBe(2);
  });

  // ---------------------------------------------------------------------------
  // Credential-URL redaction
  // ---------------------------------------------------------------------------

  it("redacts URLs with embedded credentials", () => {
    const msg = "Failed to connect to postgres://user:password@localhost:5432/db";
    const result = sanitizeError(new Error(msg));
    expect(result).toContain("***://***@");
    expect(result).not.toContain("user:password");
  });

  // ---------------------------------------------------------------------------
  // Cause unwrapping (Drizzle wraps PostgreSQL errors)
  // ---------------------------------------------------------------------------

  it("includes cause message for errors with .cause", () => {
    const err = new Error("insert failed", { cause: new Error("connection refused") });
    const result = sanitizeError(err);
    expect(result).toContain("insert failed");
    expect(result).toContain("connection refused");
    expect(result).toContain("[cause:");
  });

  it("does NOT include cause when cause is not an Error", () => {
    const err = new Error("something failed");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (err as any).cause = "just a string";
    const result = sanitizeError(err);
    expect(result).toBe("something failed");
  });

  it("does NOT include cause when err is not an Error", () => {
    // Non-Error objects don't have .cause
    const result = sanitizeError({ message: "boom", cause: new Error("nested") });
    expect(result).toBe("Unknown error");
  });

  // ---------------------------------------------------------------------------
  // Truncation
  // ---------------------------------------------------------------------------

  it("truncates message at 2000 characters", () => {
    const long = "x".repeat(3000);
    const result = sanitizeError(new Error(long));
    expect(result.length).toBe(2000);
  });

  it("does NOT truncate messages under 2000 characters", () => {
    const msg = "short error";
    expect(sanitizeError(new Error(msg))).toBe("short error");
  });

  // ---------------------------------------------------------------------------
  // Combined redactions
  // ---------------------------------------------------------------------------

  it("applies all redactions to a combined message", () => {
    const msg =
      "Error: API key sk-abc123def456ghi789jkl012mno345pqr678stu failed. " +
      "Connection: postgres://admin:secret@db.example.com:5432/mydb. " +
      "Contact support@example.com. " +
      "Query: SELECT * FROM users;";
    const result = sanitizeError(new Error(msg));
    expect(result).toContain("sk-***");
    expect(result).toContain("***://***@");
    expect(result).toContain("[email redacted]");
    expect(result).toContain("[SQL redacted]");
  });
});
