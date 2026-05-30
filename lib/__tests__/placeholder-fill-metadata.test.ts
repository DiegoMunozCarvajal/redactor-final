import { describe, expect, it } from "vitest";

import { buildPlaceholderFillMetadata } from "@/lib/placeholder-fill-metadata";

describe("placeholder fill metadata", () => {
  it("stores research provider, sources, rag chunks, and fill time", () => {
    expect(
      buildPlaceholderFillMetadata({
        provider: "rag",
        sources: [
          {
            title: "Source",
            url: "https://example.com",
            snippet: "Evidence",
            provider: "exa",
          },
        ],
        ragChunks: 3,
        model: "deepseek-v4-pro",
        filledAt: "2026-05-30T12:00:00.000Z",
      }),
    ).toEqual({
      provider: "rag",
      sources: [
        {
          title: "Source",
          url: "https://example.com",
          snippet: "Evidence",
          provider: "exa",
        },
      ],
      ragChunks: 3,
      model: "deepseek-v4-pro",
      filledAt: "2026-05-30T12:00:00.000Z",
    });
  });

  it("normalizes empty sources and omitted optional values", () => {
    expect(
      buildPlaceholderFillMetadata({
        provider: "direct",
        filledAt: "2026-05-30T12:00:00.000Z",
      }),
    ).toEqual({
      provider: "direct",
      sources: [],
      filledAt: "2026-05-30T12:00:00.000Z",
    });
  });
});
