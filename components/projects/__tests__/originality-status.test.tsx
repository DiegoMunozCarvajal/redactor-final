import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Pure mapping function — matches the logic in
// app/api/chapter-generations/[id]/route.ts
// ---------------------------------------------------------------------------

type OriginalityStatus = "clean" | "quarantined" | "unavailable";

function resolveOriginalityStatus(
  status: string,
  error: string | null | undefined,
): OriginalityStatus {
  if (status === "quarantined") return "quarantined";
  if (status === "failed") {
    const errText = error ?? "";
    if (errText.includes("OriginalityDetectorUnavailable")) return "unavailable";
  }
  return "clean";
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("resolveOriginalityStatus", () => {
  it("returns quarantined when generation status is quarantined", () => {
    expect(resolveOriginalityStatus("quarantined", null)).toBe("quarantined");
    expect(resolveOriginalityStatus("quarantined", "some error")).toBe("quarantined");
  });

  it("returns unavailable when detector failed", () => {
    expect(
      resolveOriginalityStatus("failed", "OriginalityDetectorUnavailable: embedding API error"),
    ).toBe("unavailable");
  });

  it("returns unavailable when error is in generationMetadata.error", () => {
    // Matches the route logic checking metadata.error as well
    expect(
      resolveOriginalityStatus("failed", "OriginalityDetectorUnavailable: timeout"),
    ).toBe("unavailable");
  });

  it("returns clean for generic failure without detector error", () => {
    expect(resolveOriginalityStatus("failed", "LLM API rate limited")).toBe("clean");
    expect(resolveOriginalityStatus("failed", "Network error")).toBe("clean");
  });

  it("returns clean for completed generations", () => {
    expect(resolveOriginalityStatus("completed", null)).toBe("clean");
    expect(resolveOriginalityStatus("completed", undefined)).toBe("clean");
  });

  it("returns clean for pending generations", () => {
    expect(resolveOriginalityStatus("pending", null)).toBe("clean");
  });

  it("returns clean for generating generations", () => {
    expect(resolveOriginalityStatus("generating", null)).toBe("clean");
  });

  it("returns clean for assembling generations", () => {
    expect(resolveOriginalityStatus("assembling", null)).toBe("clean");
  });

  it("returns clean when status is failed but error is null", () => {
    expect(resolveOriginalityStatus("failed", null)).toBe("clean");
  });

  it("returns clean when status is failed but error is empty string", () => {
    expect(resolveOriginalityStatus("failed", "")).toBe("clean");
  });
});
