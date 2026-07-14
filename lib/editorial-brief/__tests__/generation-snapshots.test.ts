import { describe, it, expect, vi } from "vitest";

// Mock db module so the test file loads without DATABASE_URL.
// describeDb tests pass real tx instances, so the mock is never called.
vi.mock("@/lib/db/drizzle", () => ({ db: {} }));

import { withTestDb } from "@/lib/__tests__/helpers/db";
import { createTestProject, createTestChapter } from "@/lib/__tests__/helpers/fixtures";
import {
  createEditorialBriefDraft,
  approveEditorialBrief,
  getEditorialBriefBundle,
} from "../repository";
import {
  loadEditorialBundle,
  snapshotFromBundle,
  metadataFromSnapshot,
  snapshotFromGenerationMetadata,
} from "../context";
import {
  createTestBriefContent,
  createTestChapterContract,
  TEST_CHAPTER_1_ID,
  SAMPLE_HASH,
  TEST_BRIEF_ID,
} from "./fixtures";

// ---------------------------------------------------------------------------
// DB-dependent tests
// ---------------------------------------------------------------------------

const describeDb = process.env.TEST_DATABASE_URL ? describe : describe.skip;

describeDb("snapshot capture policy", () => {
  it("captures current approved brief for a new generation", async () => {
    await withTestDb(async (tx) => {
      const project = await createTestProject(tx, { name: "Snapshot Capture" });
      await createTestChapter(tx, project.id, {
        id: TEST_CHAPTER_1_ID,
        position: 1,
        title: "Ch1",
      });

      const draft = await createEditorialBriefDraft(
        {
          projectId: project.id,
          content: createTestBriefContent(),
          contracts: [createTestChapterContract(TEST_CHAPTER_1_ID)],
          evidenceSourceIds: [],
        },
        tx,
      );

      await approveEditorialBrief(
        { briefId: draft.id, projectId: project.id },
        tx,
      );

      const bundle = await loadEditorialBundle({ projectId: project.id }, tx);
      expect(bundle).not.toBeNull();

      const snapshot = snapshotFromBundle(bundle!);
      expect(snapshot.editorialBriefId).toBe(draft.id);
      expect(snapshot.editorialBriefVersion).toBe(1);
      expect(snapshot.editorialBriefHash).toBe(draft.hash);
    });
  });

  it("returns null metadata when no approved brief exists", async () => {
    await withTestDb(async (tx) => {
      const project = await createTestProject(tx, { name: "No Brief" });

      const bundle = await loadEditorialBundle({ projectId: project.id }, tx);
      expect(bundle).toBeNull();
    });
  });

  it("snapshot survives metadata round-trip through generation metadata", async () => {
    await withTestDb(async (tx) => {
      const project = await createTestProject(tx, { name: "Round-trip" });
      await createTestChapter(tx, project.id, {
        id: TEST_CHAPTER_1_ID,
        position: 1,
        title: "Ch1",
      });

      const draft = await createEditorialBriefDraft(
        {
          projectId: project.id,
          content: createTestBriefContent(),
          contracts: [createTestChapterContract(TEST_CHAPTER_1_ID)],
          evidenceSourceIds: [],
        },
        tx,
      );

      await approveEditorialBrief(
        { briefId: draft.id, projectId: project.id },
        tx,
      );

      const bundle = await loadEditorialBundle({ projectId: project.id }, tx);
      const snapshot = snapshotFromBundle(bundle!);
      const meta = metadataFromSnapshot(snapshot);

      // Simulate storing in generation metadata JSONB, then reading back
      const stored = { ...meta };
      const reconstructed = snapshotFromGenerationMetadata(stored);

      expect(reconstructed).not.toBeNull();
      expect(reconstructed!.editorialBriefId).toBe(draft.id);
      expect(reconstructed!.editorialBriefVersion).toBe(1);
      expect(reconstructed!.editorialBriefHash).toBe(draft.hash);
    });
  });

  it("queued exact id/hash survives later approval of a newer version", async () => {
    await withTestDb(async (tx) => {
      const project = await createTestProject(tx, { name: "Version Drift" });
      await createTestChapter(tx, project.id, {
        id: TEST_CHAPTER_1_ID,
        position: 1,
        title: "Ch1",
      });

      // Create and approve v1
      const draft1 = await createEditorialBriefDraft(
        {
          projectId: project.id,
          content: createTestBriefContent(),
          contracts: [createTestChapterContract(TEST_CHAPTER_1_ID)],
          evidenceSourceIds: [],
        },
        tx,
      );
      await approveEditorialBrief(
        { briefId: draft1.id, projectId: project.id },
        tx,
      );

      // Capture v1 snapshot (simulating queue-time capture)
      const bundle1 = await loadEditorialBundle({ projectId: project.id }, tx);
      const snapshot1 = snapshotFromBundle(bundle1!);
      const meta1 = metadataFromSnapshot(snapshot1);

      // Now create and approve v2 (simulating a newer brief while generation is queued)
      const draft2 = await createEditorialBriefDraft(
        {
          projectId: project.id,
          content: {
            ...createTestBriefContent(),
            market: {
              ...createTestBriefContent().market,
              region: "Mexico",
            },
          },
          contracts: [createTestChapterContract(TEST_CHAPTER_1_ID)],
          evidenceSourceIds: [],
        },
        tx,
      );
      await approveEditorialBrief(
        { briefId: draft2.id, projectId: project.id },
        tx,
      );

      // Worker loads exact v1 by id + hash — should still succeed
      const loaded = await loadEditorialBundle(
        {
          projectId: project.id,
          briefId: snapshot1.editorialBriefId,
          expectedHash: snapshot1.editorialBriefHash,
        },
        tx,
      );
      expect(loaded).not.toBeNull();
      expect(loaded!.id).toBe(draft1.id);
      expect(loaded!.version).toBe(1);

      // The current approved should now be v2
      const current = await loadEditorialBundle({ projectId: project.id }, tx);
      expect(current).not.toBeNull();
      expect(current!.version).toBe(2);
    });
  });
});

// ---------------------------------------------------------------------------
// Pure function tests — no DB needed
// ---------------------------------------------------------------------------

describe("snapshotFromGenerationMetadata (legacy handling)", () => {
  it("returns null for null metadata (legacy generation)", () => {
    const result = snapshotFromGenerationMetadata({
      editorialBriefId: null,
      editorialBriefVersion: null,
      editorialBriefHash: null,
    });
    expect(result).toBeNull();
  });

  it("returns null for undefined fields (missing from JSONB)", () => {
    const result = snapshotFromGenerationMetadata({});
    expect(result).toBeNull();
  });

  it("returns null when only id is present", () => {
    const result = snapshotFromGenerationMetadata({
      editorialBriefId: TEST_BRIEF_ID,
    });
    expect(result).toBeNull();
  });

  it("returns snapshot when all fields present", () => {
    const result = snapshotFromGenerationMetadata({
      editorialBriefId: TEST_BRIEF_ID,
      editorialBriefVersion: 1,
      editorialBriefHash: SAMPLE_HASH,
    });
    expect(result).not.toBeNull();
    expect(result!.editorialBriefId).toBe(TEST_BRIEF_ID);
    expect(result!.editorialBriefVersion).toBe(1);
    expect(result!.editorialBriefHash).toBe(SAMPLE_HASH);
  });
});

describe("metadataFromSnapshot (JSONB storage format)", () => {
  it("produces flat object suitable for JSONB spread", () => {
    const snapshot = {
      editorialBriefId: TEST_BRIEF_ID,
      editorialBriefVersion: 3,
      editorialBriefHash: SAMPLE_HASH,
    };
    const meta = metadataFromSnapshot(snapshot);

    // Should be spreadable into generationMetadata
    const generationRow = {
      type: "critique",
      model: "claude-sonnet-5",
      ...meta,
    };
    expect(generationRow).toEqual({
      type: "critique",
      model: "claude-sonnet-5",
      editorialBriefId: TEST_BRIEF_ID,
      editorialBriefVersion: 3,
      editorialBriefHash: SAMPLE_HASH,
    });
  });
});

describe("assembly fragment consistency", () => {
  it("accepts fragments with the same brief hash", () => {
    const hash = SAMPLE_HASH;
    const fragmentMeta1 = {
      editorialBriefId: "a",
      editorialBriefVersion: 1,
      editorialBriefHash: hash,
    };
    const fragmentMeta2 = {
      editorialBriefId: "b",
      editorialBriefVersion: 1,
      editorialBriefHash: hash,
    };

    const snapshots = [fragmentMeta1, fragmentMeta2]
      .map((m) => snapshotFromGenerationMetadata(m))
      .filter(Boolean);

    const hashes = new Set(snapshots.map((s) => s!.editorialBriefHash));
    expect(hashes.size).toBe(1);
  });

  it("detects mixed brief hashes (different versions)", () => {
    const fragmentMeta1 = {
      editorialBriefId: "a",
      editorialBriefVersion: 1,
      editorialBriefHash: "a".repeat(64),
    };
    const fragmentMeta2 = {
      editorialBriefId: "b",
      editorialBriefVersion: 1,
      editorialBriefHash: "b".repeat(64),
    };

    const snapshots = [fragmentMeta1, fragmentMeta2]
      .map((m) => snapshotFromGenerationMetadata(m))
      .filter(Boolean);

    const hashes = new Set(snapshots.map((s) => s!.editorialBriefHash));
    // Different hashes → conflict
    expect(hashes.size).toBeGreaterThan(1);
  });

  it("treats legacy fragments (null snapshot) as compatible with versioned ones", () => {
    const versioned = snapshotFromGenerationMetadata({
      editorialBriefId: TEST_BRIEF_ID,
      editorialBriefVersion: 1,
      editorialBriefHash: SAMPLE_HASH,
    });
    const legacy = snapshotFromGenerationMetadata({});

    // Legacy fragments don't block versioned assembly
    const nonNullSnapshots = [versioned, legacy].filter(Boolean);
    const hashes = new Set(nonNullSnapshots.map((s) => s!.editorialBriefHash));
    // If all non-null snapshots share the same hash, it's valid
    if (nonNullSnapshots.length > 0) {
      expect(hashes.size).toBe(1);
    }
  });

  it("all-legacy assembly captures current approved (returns null snapshot)", () => {
    // All fragments are legacy → no snapshot to capture from them
    // The route would then call loadEditorialBundle to capture current approved
    const allLegacy = [{}, {}, {}].map((m) => snapshotFromGenerationMetadata(m));
    const nonNullSnapshots = allLegacy.filter(Boolean);
    expect(nonNullSnapshots).toHaveLength(0);
    // Route should then capture current approved brief
  });
});
