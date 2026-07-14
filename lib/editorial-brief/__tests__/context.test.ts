import { describe, it, expect } from "vitest";
import { withTestDb } from "@/lib/__tests__/helpers/db";
import { createTestProject, createTestChapter } from "@/lib/__tests__/helpers/fixtures";
import * as schema from "@/lib/db/schema";
import { createEditorialBriefDraft, approveEditorialBrief } from "../repository";
import {
  createTestBriefContent,
  createTestChapterContract,
  createTestEditorialBundle,
  TEST_CHAPTER_1_ID,
  TEST_EVIDENCE_SOURCE_ID,
  SAMPLE_HASH,
  TEST_BRIEF_ID,
} from "./fixtures";
import {
  loadEditorialBundle,
  snapshotFromBundle,
  metadataFromSnapshot,
  snapshotFromGenerationMetadata,
} from "../context";
import type { EditorialBundle } from "../schema";

// ---------------------------------------------------------------------------
// DB-dependent tests — skip when no test database
// ---------------------------------------------------------------------------

const describeDb = process.env.TEST_DATABASE_URL ? describe : describe.skip;

describeDb("loadEditorialBundle", () => {
  it("loads current approved brief by projectId", async () => {
    await withTestDb(async (tx) => {
      const project = await createTestProject(tx, { name: "Approved Lookup" });
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
      expect(bundle!.id).toBe(draft.id);
      expect(bundle!.version).toBe(1);
      expect(bundle!.hash).toBe(draft.hash);
      expect(bundle!.content.market.region).toBe("United States");
    });
  });

  it("loads exact brief by briefId", async () => {
    await withTestDb(async (tx) => {
      const project = await createTestProject(tx, { name: "Exact Lookup" });
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

      const bundle = await loadEditorialBundle({
        projectId: project.id,
        briefId: draft.id,
      }, tx);
      expect(bundle).not.toBeNull();
      expect(bundle!.id).toBe(draft.id);
    });
  });

  it("throws when expectedHash does not match", async () => {
    await withTestDb(async (tx) => {
      const project = await createTestProject(tx, { name: "Hash Mismatch" });
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

      await expect(
        loadEditorialBundle({
          projectId: project.id,
          briefId: draft.id,
          expectedHash: SAMPLE_HASH,
        }, tx),
      ).rejects.toThrow("hash mismatch");
    });
  });

  it("returns null for wrong project", async () => {
    await withTestDb(async (tx) => {
      const project = await createTestProject(tx, { name: "Wrong Project" });
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

      const otherProjectId = "00000000-0000-0000-0000-000000000001";
      const bundle = await loadEditorialBundle({
        projectId: otherProjectId,
        briefId: draft.id,
      }, tx);
      expect(bundle).toBeNull();
    });
  });

  it("returns null when no approved brief exists", async () => {
    await withTestDb(async (tx) => {
      const project = await createTestProject(tx, { name: "No Approved" });

      const bundle = await loadEditorialBundle({ projectId: project.id }, tx);
      expect(bundle).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// Pure function tests — no DB needed
// ---------------------------------------------------------------------------

describe("snapshotFromBundle", () => {
  it("extracts id, version, and hash from bundle", () => {
    const bundle: EditorialBundle = createTestEditorialBundle({
      id: TEST_BRIEF_ID,
      version: 3,
      hash: SAMPLE_HASH,
    });

    const snapshot = snapshotFromBundle(bundle);
    expect(snapshot).toEqual({
      editorialBriefId: TEST_BRIEF_ID,
      editorialBriefVersion: 3,
      editorialBriefHash: SAMPLE_HASH,
    });
  });
});

describe("metadataFromSnapshot", () => {
  it("converts snapshot to flat metadata object", () => {
    const snapshot = {
      editorialBriefId: TEST_BRIEF_ID,
      editorialBriefVersion: 2,
      editorialBriefHash: SAMPLE_HASH,
    };

    const meta = metadataFromSnapshot(snapshot);
    expect(meta).toEqual({
      editorialBriefId: TEST_BRIEF_ID,
      editorialBriefVersion: 2,
      editorialBriefHash: SAMPLE_HASH,
    });
  });
});

describe("snapshotFromGenerationMetadata", () => {
  it("returns null when all fields are null", () => {
    const result = snapshotFromGenerationMetadata({
      editorialBriefId: null,
      editorialBriefVersion: null,
      editorialBriefHash: null,
    });
    expect(result).toBeNull();
  });

  it("returns null when fields are undefined", () => {
    const result = snapshotFromGenerationMetadata({});
    expect(result).toBeNull();
  });

  it("returns null when editorialBriefId is missing", () => {
    const result = snapshotFromGenerationMetadata({
      editorialBriefId: null,
      editorialBriefVersion: 1,
      editorialBriefHash: SAMPLE_HASH,
    });
    expect(result).toBeNull();
  });

  it("returns null when editorialBriefVersion is missing", () => {
    const result = snapshotFromGenerationMetadata({
      editorialBriefId: TEST_BRIEF_ID,
      editorialBriefVersion: null,
      editorialBriefHash: SAMPLE_HASH,
    });
    expect(result).toBeNull();
  });

  it("returns null when editorialBriefHash is missing", () => {
    const result = snapshotFromGenerationMetadata({
      editorialBriefId: TEST_BRIEF_ID,
      editorialBriefVersion: 1,
      editorialBriefHash: null,
    });
    expect(result).toBeNull();
  });

  it("returns snapshot when all fields are present", () => {
    const result = snapshotFromGenerationMetadata({
      editorialBriefId: TEST_BRIEF_ID,
      editorialBriefVersion: 1,
      editorialBriefHash: SAMPLE_HASH,
    });
    expect(result).toEqual({
      editorialBriefId: TEST_BRIEF_ID,
      editorialBriefVersion: 1,
      editorialBriefHash: SAMPLE_HASH,
    });
  });
});

describe("snapshotFromBundle round-trip through metadataFromSnapshot", () => {
  it("round-trips correctly", () => {
    const bundle = createTestEditorialBundle({
      id: TEST_BRIEF_ID,
      version: 2,
      hash: SAMPLE_HASH,
    });

    const snapshot = snapshotFromBundle(bundle);
    const meta = metadataFromSnapshot(snapshot);

    expect(meta.editorialBriefId).toBe(TEST_BRIEF_ID);
    expect(meta.editorialBriefVersion).toBe(2);
    expect(meta.editorialBriefHash).toBe(SAMPLE_HASH);

    // Reconstruct back to snapshot
    const reconstructed = snapshotFromGenerationMetadata(meta);
    expect(reconstructed).toEqual(snapshot);
  });
});
