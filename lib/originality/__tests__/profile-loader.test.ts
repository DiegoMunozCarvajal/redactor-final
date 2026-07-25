// ---------------------------------------------------------------------------
// Profile Loader Tests
// ---------------------------------------------------------------------------

import { describe, expect, it, vi, beforeEach } from "vitest";
import { sha256Canonical, EMPTY_SOURCE_PROFILE_SET_HASH } from "@/lib/template-pipeline/hash";

const { mockDbSelect, mockGenerateEmbeddings } = vi.hoisted(() => ({
  mockDbSelect: vi.fn(),
  mockGenerateEmbeddings: vi.fn(),
}));

vi.mock("@/lib/db/drizzle", () => ({
  db: { select: (...args: unknown[]) => mockDbSelect(...args) },
}));

vi.mock("@/lib/ai/embeddings", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/ai/embeddings")
  >("@/lib/ai/embeddings");
  return { ...actual, generateEmbeddings: mockGenerateEmbeddings };
});

import { loadOriginalityProfileSet, getRiskLabelEmbeddings } from "../profile-loader";
import type { LoadedProfileSet } from "../profile-loader";
import { OriginalityDetectorUnavailableError } from "../contracts";
import type { GenerationAuthorization } from "@/lib/template-pipeline/contracts";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const sourceFreeAuth: GenerationAuthorization = {
  scope: "source-free",
  pipelineRunId: null,
  sourceProfileSetHash: EMPTY_SOURCE_PROFILE_SET_HASH,
  originalityPolicyVersion: "originality-policy-v2",
};

function templateAuth(
  overrides: Partial<GenerationAuthorization> = {},
): GenerationAuthorization {
  return {
    scope: "template",
    pipelineRunId: "test-run-1",
    sourceProfileSetHash: "",
    originalityPolicyVersion: "originality-policy-v2",
    ...overrides,
  } as GenerationAuthorization;
}

// ---------------------------------------------------------------------------
// loadOriginalityProfileSet
// ---------------------------------------------------------------------------

describe("loadOriginalityProfileSet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -----------------------------------------------------------------------
  // Source-free
  // -----------------------------------------------------------------------

  it("returns immutable empty set for source-free scope", async () => {
    const result = await loadOriginalityProfileSet(sourceFreeAuth);

    expect(result.scope).toBe("source-free");
    expect(result.pipelineRunId).toBeNull();
    expect(result.profileSetHash).toBe(EMPTY_SOURCE_PROFILE_SET_HASH);
    expect(result.profiles).toEqual([]);
    // No DB queries should be made for source-free scope
    expect(mockDbSelect).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Missing profiles
  // -----------------------------------------------------------------------

  it("throws when no profiles found for pipeline run", async () => {
    mockDbSelect.mockReturnValueOnce({
      from: vi.fn().mockReturnValueOnce({
        where: vi.fn().mockResolvedValue([]),
      }),
    });

    await expect(
      loadOriginalityProfileSet(templateAuth({ pipelineRunId: "empty-run" })),
    ).rejects.toThrow(OriginalityDetectorUnavailableError);
  });

  // -----------------------------------------------------------------------
  // Profile found but has no chunks
  // -----------------------------------------------------------------------

  it("throws when profile has no chunks", async () => {
    const profilesData = [
      {
        id: "profile-id-1",
        profileHash: "hash-val",
        elements: [],
      },
    ];

    mockDbSelect
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockResolvedValue(profilesData),
        }),
      })
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue([]),
          }),
        }),
      });

    await expect(
      loadOriginalityProfileSet(
        templateAuth({
          pipelineRunId: "no-chunks",
          sourceProfileSetHash: "irrelevant",
        }),
      ),
    ).rejects.toThrow(OriginalityDetectorUnavailableError);
  });

  // -----------------------------------------------------------------------
  // Hash mismatch
  // -----------------------------------------------------------------------

  it("throws on hash mismatch between stored and computed", async () => {
    const profilesData = [
      {
        id: "profile-1",
        profileHash: "hash-value",
        elements: [],
      },
    ];
    const chunksData = [
      {
        contentHash: "chunk-hash-1",
        lexicalFingerprint: { shingles5: ["s5-a"], shingles8: ["s8-a"] },
        embedding: "[0.1, 0.2]",
      },
    ];

    mockDbSelect
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockResolvedValue(profilesData),
        }),
      })
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue(chunksData),
          }),
        }),
      });

    await expect(
      loadOriginalityProfileSet(
        templateAuth({ sourceProfileSetHash: "definitely-wrong-hash" }),
      ),
    ).rejects.toThrow(OriginalityDetectorUnavailableError);
  });

  // -----------------------------------------------------------------------
  // Successful load with hash verification
  // -----------------------------------------------------------------------

  it("loads and verifies profile set with correct hash", async () => {
    const profileHash = "test-profile-hash";
    const expectedSetHash = sha256Canonical([profileHash]);

    const profilesData = [
      {
        id: "profile-1",
        profileHash,
        elements: [
          {
            id: "elem-1",
            kind: "metaphor" as const,
            canonicalLabel: "melting ice",
            aliases: [],
            sourceChunkIndexes: [0],
            confidence: 0.9,
            distinctiveness: 0.95,
          },
        ],
      },
    ];
    const chunksData = [
      {
        contentHash: "chunk-hash-1",
        lexicalFingerprint: {
          shingles5: ["s5-a", "s5-b"],
          shingles8: ["s8-a"],
        },
        embedding: "[0.1, 0.2, 0.3]",
      },
    ];

    mockDbSelect
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockResolvedValue(profilesData),
        }),
      })
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue(chunksData),
          }),
        }),
      });

    const result = await loadOriginalityProfileSet(
      templateAuth({ sourceProfileSetHash: expectedSetHash }),
    );

    expect(result.scope).toBe("template");
    expect(result.pipelineRunId).toBe("test-run-1");
    expect(result.profileSetHash).toBe(expectedSetHash);
    expect(result.profiles).toHaveLength(1);

    const profile = result.profiles[0];
    expect(profile.id).toBe("profile-1");
    expect(profile.profileHash).toBe(profileHash);
    expect(profile.elements).toEqual(profilesData[0].elements);
    expect(profile.chunks).toHaveLength(1);

    const chunk = profile.chunks[0];
    expect(chunk.contentHash).toBe("chunk-hash-1");
    expect(chunk.shingles5).toEqual(new Set(["s5-a", "s5-b"]));
    expect(chunk.shingles8).toEqual(new Set(["s8-a"]));
    expect(chunk.embedding).toEqual([0.1, 0.2, 0.3]);
  });
});

// ---------------------------------------------------------------------------
// getRiskLabelEmbeddings
// ---------------------------------------------------------------------------

describe("getRiskLabelEmbeddings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -----------------------------------------------------------------------
  // Source-free profile set
  // -----------------------------------------------------------------------

  it("returns empty for source-free profile set", async () => {
    const profileSet: LoadedProfileSet = {
      scope: "source-free",
      pipelineRunId: null,
      profileSetHash: EMPTY_SOURCE_PROFILE_SET_HASH,
      profiles: [],
    };

    const results = await getRiskLabelEmbeddings(profileSet, 0.8);
    expect(results).toEqual([]);
    expect(mockGenerateEmbeddings).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Empty elements array
  // -----------------------------------------------------------------------

  it("returns empty when profile has no elements", async () => {
    const profileSet: LoadedProfileSet = {
      scope: "template",
      pipelineRunId: "run-1",
      profileSetHash: "empty-elements",
      profiles: [
        {
          id: "p1",
          profileHash: "h1",
          elements: [],
          chunks: [],
        },
      ],
    };

    const results = await getRiskLabelEmbeddings(profileSet, 0.8);
    expect(results).toEqual([]);
    expect(mockGenerateEmbeddings).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Below-threshold confidence excluded
  // -----------------------------------------------------------------------

  it("excludes below-threshold confidence elements", async () => {
    const profileSet: LoadedProfileSet = {
      scope: "template",
      pipelineRunId: "run-1",
      profileSetHash: "threshold-test",
      profiles: [
        {
          id: "p1",
          profileHash: "h1",
          elements: [
            {
              id: "elem-low",
              kind: "coined_term",
              canonicalLabel: "low-confidence term",
              aliases: [],
              sourceChunkIndexes: [0],
              confidence: 0.5,
              distinctiveness: 0.9,
            },
          ],
          chunks: [],
        },
      ],
    };

    const results = await getRiskLabelEmbeddings(profileSet, 0.8);
    expect(results).toEqual([]);
    expect(mockGenerateEmbeddings).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Includes aliases and canonical labels
  // -----------------------------------------------------------------------

  it("includes canonical label and aliases above threshold", async () => {
    mockGenerateEmbeddings.mockImplementation(
      async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3]),
    );

    const profileSet: LoadedProfileSet = {
      scope: "template",
      pipelineRunId: "run-1",
      profileSetHash: "alias-test",
      profiles: [
        {
          id: "p1",
          profileHash: "h1",
          elements: [
            {
              id: "elem-1",
              kind: "metaphor",
              canonicalLabel: "melting ice",
              aliases: ["ice melt", "glacial retreat"],
              sourceChunkIndexes: [0],
              confidence: 0.95,
              distinctiveness: 0.9,
            },
          ],
          chunks: [],
        },
      ],
    };

    const results = await getRiskLabelEmbeddings(profileSet, 0.8);

    expect(results).toHaveLength(3);
    expect(results.map((r) => r.canonicalLabel).sort()).toEqual([
      "glacial retreat",
      "ice melt",
      "melting ice",
    ]);
    for (const r of results) {
      expect(r.embedding).toEqual([0.1, 0.2, 0.3]);
    }
    expect(mockGenerateEmbeddings).toHaveBeenCalledTimes(1);
  });

  // -----------------------------------------------------------------------
  // Cached embeddings
  // -----------------------------------------------------------------------

  it("returns cached results on subsequent calls with same profile set", async () => {
    mockGenerateEmbeddings.mockImplementation(
      async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3]),
    );

    const profileSet: LoadedProfileSet = {
      scope: "template",
      pipelineRunId: "run-1",
      profileSetHash: "cache-test-key",
      profiles: [
        {
          id: "p1",
          profileHash: "h1",
          elements: [
            {
              id: "elem-1",
              kind: "metaphor",
              canonicalLabel: "cached label",
              aliases: [],
              sourceChunkIndexes: [0],
              confidence: 0.95,
              distinctiveness: 0.9,
            },
          ],
          chunks: [],
        },
      ],
    };

    const r1 = await getRiskLabelEmbeddings(profileSet, 0.8);
    expect(mockGenerateEmbeddings).toHaveBeenCalledTimes(1);
    expect(r1).toHaveLength(1);
    expect(r1[0].canonicalLabel).toBe("cached label");

    // Second call with same hash should use cache
    const r2 = await getRiskLabelEmbeddings(profileSet, 0.8);
    expect(mockGenerateEmbeddings).toHaveBeenCalledTimes(1); // still 1
    expect(r2).toEqual(r1);
  });
});
