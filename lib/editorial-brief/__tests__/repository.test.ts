import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { withTestDb } from "@/lib/__tests__/helpers/db";
import {
  createTestProject,
  createTestChapter,
} from "@/lib/__tests__/helpers/fixtures";
import * as schema from "@/lib/db/schema";
import type { drizzle } from "drizzle-orm/postgres-js";

import {
  createEditorialBriefDraft,
  replaceEditorialBriefDraft,
  deleteEditorialBriefDraft,
  approveEditorialBrief,
  getEditorialBriefBundle,
  getApprovedEditorialBriefBundle,
  getEditorialBriefHistory,
} from "../repository";

import {
  createTestBriefContent,
  createTestChapterContract,
  TEST_CHAPTER_1_ID,
  TEST_CHAPTER_2_ID,
  TEST_EVIDENCE_SOURCE_ID,
  SAMPLE_HASH,
} from "./fixtures";

type TestDb = ReturnType<typeof drizzle<typeof schema>>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createTestSource(tx: TestDb, projectId: string, sourceId: string) {
  const [source] = await tx
    .insert(schema.sources)
    .values({
      id: sourceId,
      projectId,
      fileName: "test-source.md",
      fileType: "markdown",
      sourceKind: "reference",
      extractedText: "Test evidence content.",
      processed: false,
      chunkCount: 0,
    })
    .returning();
  return source;
}

// Skip all tests if no test database is available
const describeDb = process.env.TEST_DATABASE_URL ? describe : describe.skip;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describeDb("editorial brief repository", () => {
  it("allocates next version sequentially under project-row lock", async () => {
    await withTestDb(async (tx) => {
      const project = await createTestProject(tx, {
        name: "Version Allocation",
      });
      await createTestChapter(tx, project.id, {
        id: TEST_CHAPTER_1_ID,
        position: 1,
        title: "Ch1",
      });

      // Create draft v1
      const brief1 = await createEditorialBriefDraft(
        {
          projectId: project.id,
          content: createTestBriefContent(),
          contracts: [createTestChapterContract(TEST_CHAPTER_1_ID)],
          evidenceSourceIds: [],
        },
        tx,
      );
      expect(brief1.version).toBe(1);

      // Approve v1 to free up the draft slot
      await approveEditorialBrief(
        { briefId: brief1.id, projectId: project.id },
        tx,
      );

      // Create draft v2
      const brief2 = await createEditorialBriefDraft(
        {
          projectId: project.id,
          content: createTestBriefContent(),
          contracts: [createTestChapterContract(TEST_CHAPTER_1_ID)],
          evidenceSourceIds: [],
        },
        tx,
      );
      expect(brief2.version).toBe(2);

      // Approve v2
      await approveEditorialBrief(
        { briefId: brief2.id, projectId: project.id },
        tx,
      );

      // Create draft v3
      const brief3 = await createEditorialBriefDraft(
        {
          projectId: project.id,
          content: createTestBriefContent(),
          contracts: [createTestChapterContract(TEST_CHAPTER_1_ID)],
          evidenceSourceIds: [],
        },
        tx,
      );
      expect(brief3.version).toBe(3);
    });
  });

  it("enforces one draft per project (relies on partial unique index and FOR UPDATE serialization, not a dedicated constraint)", async () => {
    await withTestDb(async (tx) => {
      const project = await createTestProject(tx, {
        name: "One Draft Test",
      });
      await createTestChapter(tx, project.id, {
        id: TEST_CHAPTER_1_ID,
        position: 1,
        title: "Ch1",
      });

      // First draft succeeds
      await createEditorialBriefDraft(
        {
          projectId: project.id,
          content: createTestBriefContent(),
          contracts: [createTestChapterContract(TEST_CHAPTER_1_ID)],
          evidenceSourceIds: [],
        },
        tx,
      );

      // Second draft for same project should fail
      await expect(
        createEditorialBriefDraft(
          {
            projectId: project.id,
            content: createTestBriefContent(),
            contracts: [createTestChapterContract(TEST_CHAPTER_1_ID)],
            evidenceSourceIds: [],
          },
          tx,
        ),
      ).rejects.toThrow();
    });
  });

  it("allows a new draft after approving the previous draft", async () => {
    await withTestDb(async (tx) => {
      const project = await createTestProject(tx, {
        name: "Approve Then Draft",
      });
      await createTestChapter(tx, project.id, {
        id: TEST_CHAPTER_1_ID,
        position: 1,
        title: "Ch1",
      });

      // Create first draft and approve it
      const brief1 = await createEditorialBriefDraft(
        {
          projectId: project.id,
          content: createTestBriefContent(),
          contracts: [createTestChapterContract(TEST_CHAPTER_1_ID)],
          evidenceSourceIds: [],
        },
        tx,
      );
      await approveEditorialBrief(
        { briefId: brief1.id, projectId: project.id },
        tx,
      );

      // Now a second draft should work
      const brief2 = await createEditorialBriefDraft(
        {
          projectId: project.id,
          content: createTestBriefContent(),
          contracts: [createTestChapterContract(TEST_CHAPTER_1_ID)],
          evidenceSourceIds: [],
        },
        tx,
      );
      expect(brief2).toBeDefined();
      expect(brief2.version).toBe(2);
    });
  });

  it("replaces draft bundle atomically (contracts and hash)", async () => {
    await withTestDb(async (tx) => {
      const project = await createTestProject(tx, {
        name: "Replace Test",
      });
      await createTestChapter(tx, project.id, {
        id: TEST_CHAPTER_1_ID,
        position: 1,
        title: "Ch1",
      });
      await createTestChapter(tx, project.id, {
        id: TEST_CHAPTER_2_ID,
        position: 2,
        title: "Ch2",
      });

      const contract1 = createTestChapterContract(TEST_CHAPTER_1_ID);
      const contract2 = createTestChapterContract(TEST_CHAPTER_2_ID);

      // Create brief with one contract
      const brief = await createEditorialBriefDraft(
        {
          projectId: project.id,
          content: createTestBriefContent(),
          contracts: [contract1],
          evidenceSourceIds: [],
        },
        tx,
      );
      const originalHash = brief.hash;

      // Replace with different contracts
      const replaced = await replaceEditorialBriefDraft(
        {
          briefId: brief.id,
          projectId: project.id,
          content: createTestBriefContent(),
          contracts: [contract1, contract2],
          evidenceSourceIds: [],
        },
        tx,
      );

      expect(replaced.hash).not.toBe(originalHash);
      expect(replaced.contracts).toHaveLength(2);
      expect(replaced.contracts[0].chapterId).toBe(TEST_CHAPTER_1_ID);
      expect(replaced.contracts[1].chapterId).toBe(TEST_CHAPTER_2_ID);

      // Verify via DB query
      const dbContracts = await tx
        .select()
        .from(schema.chapterEditorialContracts)
        .where(
          eq(
            schema.chapterEditorialContracts.editorialBriefId,
            brief.id,
          ),
        );
      expect(dbContracts).toHaveLength(2);
    });
  });

  it("rejects chapters that do not belong to the project", async () => {
    await withTestDb(async (tx) => {
      const projectA = await createTestProject(tx, {
        name: "Project A",
      });
      const projectB = await createTestProject(tx, {
        name: "Project B",
      });
      await createTestChapter(tx, projectA.id, {
        id: TEST_CHAPTER_1_ID,
        position: 1,
        title: "Ch1",
      });

      await expect(
        createEditorialBriefDraft(
          {
            projectId: projectB.id,
            content: createTestBriefContent(),
            contracts: [createTestChapterContract(TEST_CHAPTER_1_ID)],
            evidenceSourceIds: [],
          },
          tx,
        ),
      ).rejects.toThrow("do not belong to this project");
    });
  });

  it("rejects sources that do not belong to the project", async () => {
    await withTestDb(async (tx) => {
      const projectA = await createTestProject(tx, {
        name: "Project A",
      });
      const projectB = await createTestProject(tx, {
        name: "Project B",
      });
      await createTestChapter(tx, projectB.id, {
        id: TEST_CHAPTER_1_ID,
        position: 1,
        title: "Ch1",
      });
      await createTestSource(tx, projectA.id, TEST_EVIDENCE_SOURCE_ID);

      await expect(
        createEditorialBriefDraft(
          {
            projectId: projectB.id,
            content: createTestBriefContent(),
            contracts: [createTestChapterContract(TEST_CHAPTER_1_ID)],
            evidenceSourceIds: [TEST_EVIDENCE_SOURCE_ID],
          },
          tx,
        ),
      ).rejects.toThrow("do not belong to this project");
    });
  });

  it("rejects replacement of an approved brief", async () => {
    await withTestDb(async (tx) => {
      const project = await createTestProject(tx, {
        name: "Replace Reject",
      });
      await createTestChapter(tx, project.id, {
        id: TEST_CHAPTER_1_ID,
        position: 1,
        title: "Ch1",
      });

      const brief = await createEditorialBriefDraft(
        {
          projectId: project.id,
          content: createTestBriefContent(),
          contracts: [createTestChapterContract(TEST_CHAPTER_1_ID)],
          evidenceSourceIds: [],
        },
        tx,
      );
      await approveEditorialBrief(
        { briefId: brief.id, projectId: project.id },
        tx,
      );

      await expect(
        replaceEditorialBriefDraft(
          {
            briefId: brief.id,
            projectId: project.id,
            content: createTestBriefContent(),
            contracts: [createTestChapterContract(TEST_CHAPTER_1_ID)],
            evidenceSourceIds: [],
          },
          tx,
        ),
      ).rejects.toThrow("non-draft");
    });
  });

  it("rejects deletion of an approved brief", async () => {
    await withTestDb(async (tx) => {
      const project = await createTestProject(tx, {
        name: "Delete Reject",
      });
      await createTestChapter(tx, project.id, {
        id: TEST_CHAPTER_1_ID,
        position: 1,
        title: "Ch1",
      });

      const brief = await createEditorialBriefDraft(
        {
          projectId: project.id,
          content: createTestBriefContent(),
          contracts: [createTestChapterContract(TEST_CHAPTER_1_ID)],
          evidenceSourceIds: [],
        },
        tx,
      );
      await approveEditorialBrief(
        { briefId: brief.id, projectId: project.id },
        tx,
      );

      await expect(
        deleteEditorialBriefDraft(
          { briefId: brief.id, projectId: project.id },
          tx,
        ),
      ).rejects.toThrow("non-draft");
    });
  });

  it("deletes a draft successfully", async () => {
    await withTestDb(async (tx) => {
      const project = await createTestProject(tx, {
        name: "Delete Draft",
      });
      await createTestChapter(tx, project.id, {
        id: TEST_CHAPTER_1_ID,
        position: 1,
        title: "Ch1",
      });

      const brief = await createEditorialBriefDraft(
        {
          projectId: project.id,
          content: createTestBriefContent(),
          contracts: [createTestChapterContract(TEST_CHAPTER_1_ID)],
          evidenceSourceIds: [],
        },
        tx,
      );

      await deleteEditorialBriefDraft(
        { briefId: brief.id, projectId: project.id },
        tx,
      );

      // Verify it's gone
      const [row] = await tx
        .select()
        .from(schema.editorialBriefs)
        .where(eq(schema.editorialBriefs.id, brief.id));
      expect(row).toBeUndefined();
    });
  });

  it("archives prior approved version on re-approval", async () => {
    await withTestDb(async (tx) => {
      const project = await createTestProject(tx, {
        name: "Archive Test",
      });
      await createTestChapter(tx, project.id, {
        id: TEST_CHAPTER_1_ID,
        position: 1,
        title: "Ch1",
      });

      // Create and approve v1
      const v1 = await createEditorialBriefDraft(
        {
          projectId: project.id,
          content: createTestBriefContent(),
          contracts: [createTestChapterContract(TEST_CHAPTER_1_ID)],
          evidenceSourceIds: [],
        },
        tx,
      );
      await approveEditorialBrief(
        { briefId: v1.id, projectId: project.id },
        tx,
      );

      // Create and approve v2
      const v2 = await createEditorialBriefDraft(
        {
          projectId: project.id,
          content: createTestBriefContent(),
          contracts: [createTestChapterContract(TEST_CHAPTER_1_ID)],
          evidenceSourceIds: [],
        },
        tx,
      );
      await approveEditorialBrief(
        { briefId: v2.id, projectId: project.id },
        tx,
      );

      // Verify v1 is archived
      const [archiveRow] = await tx
        .select({ status: schema.editorialBriefs.status })
        .from(schema.editorialBriefs)
        .where(eq(schema.editorialBriefs.id, v1.id));
      expect(archiveRow.status).toBe("archived");

      // Verify v2 is approved
      const [approvedRow] = await tx
        .select({ status: schema.editorialBriefs.status })
        .from(schema.editorialBriefs)
        .where(eq(schema.editorialBriefs.id, v2.id));
      expect(approvedRow.status).toBe("approved");
    });
  });

  it("loads bundle by id and verifies project and hash", async () => {
    await withTestDb(async (tx) => {
      const project = await createTestProject(tx, {
        name: "Load Test",
      });
      await createTestChapter(tx, project.id, {
        id: TEST_CHAPTER_1_ID,
        position: 1,
        title: "Ch1",
      });
      await createTestChapter(tx, project.id, {
        id: TEST_CHAPTER_2_ID,
        position: 2,
        title: "Ch2",
      });
      await createTestSource(tx, project.id, TEST_EVIDENCE_SOURCE_ID);

      const brief = await createEditorialBriefDraft(
        {
          projectId: project.id,
          content: createTestBriefContent(),
          contracts: [
            createTestChapterContract(TEST_CHAPTER_1_ID),
            createTestChapterContract(TEST_CHAPTER_2_ID),
          ],
          evidenceSourceIds: [TEST_EVIDENCE_SOURCE_ID],
        },
        tx,
      );

      // Load with correct project and brief id
      const loaded = await getEditorialBriefBundle(
        { projectId: project.id, briefId: brief.id },
        tx,
      );
      expect(loaded).not.toBeNull();
      expect(loaded!.hash).toBe(brief.hash);
      expect(loaded!.contracts).toHaveLength(2);
      expect(loaded!.evidenceSourceIds).toEqual([TEST_EVIDENCE_SOURCE_ID]);

      // Load with wrong project returns null
      const wrongProject = await getEditorialBriefBundle(
        {
          projectId: "00000000-0000-0000-0000-000000000000",
          briefId: brief.id,
        },
        tx,
      );
      expect(wrongProject).toBeNull();

      // Load with correct hash succeeds
      const withHash = await getEditorialBriefBundle(
        {
          projectId: project.id,
          briefId: brief.id,
          expectedHash: brief.hash,
        },
        tx,
      );
      expect(withHash).not.toBeNull();

      // Load with wrong hash throws
      await expect(
        getEditorialBriefBundle(
          {
            projectId: project.id,
            briefId: brief.id,
            expectedHash: SAMPLE_HASH,
          },
          tx,
        ),
      ).rejects.toThrow("hash mismatch");
    });
  });

  it("returns null for getApprovedEditorialBriefBundle when no approved brief exists", async () => {
    await withTestDb(async (tx) => {
      const project = await createTestProject(tx, {
        name: "No Approved",
      });

      const result = await getApprovedEditorialBriefBundle(project.id, tx);
      expect(result).toBeNull();
    });
  });

  it("returns approved bundle when one exists", async () => {
    await withTestDb(async (tx) => {
      const project = await createTestProject(tx, {
        name: "Has Approved",
      });
      await createTestChapter(tx, project.id, {
        id: TEST_CHAPTER_1_ID,
        position: 1,
        title: "Ch1",
      });

      const brief = await createEditorialBriefDraft(
        {
          projectId: project.id,
          content: createTestBriefContent(),
          contracts: [createTestChapterContract(TEST_CHAPTER_1_ID)],
          evidenceSourceIds: [],
        },
        tx,
      );
      await approveEditorialBrief(
        { briefId: brief.id, projectId: project.id },
        tx,
      );

      const result = await getApprovedEditorialBriefBundle(project.id, tx);
      expect(result).not.toBeNull();
      expect(result!.id).toBe(brief.id);
      expect(result!.version).toBe(1);
    });
  });

  it("returns version history ordered by version DESC with all statuses", async () => {
    await withTestDb(async (tx) => {
      const project = await createTestProject(tx, { name: "History Test" });
      await createTestChapter(tx, project.id, {
        id: TEST_CHAPTER_1_ID,
        position: 1,
        title: "Ch1",
      });

      // Create v1 and approve it
      const v1 = await createEditorialBriefDraft(
        {
          projectId: project.id,
          content: createTestBriefContent(),
          contracts: [createTestChapterContract(TEST_CHAPTER_1_ID)],
          evidenceSourceIds: [],
        },
        tx,
      );
      await approveEditorialBrief(
        { briefId: v1.id, projectId: project.id },
        tx,
      );

      // Create v2 and leave as draft
      const v2 = await createEditorialBriefDraft(
        {
          projectId: project.id,
          content: createTestBriefContent(),
          contracts: [createTestChapterContract(TEST_CHAPTER_1_ID)],
          evidenceSourceIds: [],
        },
        tx,
      );

      const history = await getEditorialBriefHistory(project.id, tx);
      expect(history).toHaveLength(2);
      expect(history[0].version).toBe(2); // DESC order
      expect(history[1].version).toBe(1);
      expect(history.map((h) => h.status)).toContain("approved");
      expect(history.map((h) => h.status)).toContain("draft");
    });
  });

  it("returns empty array for project with no editorial briefs", async () => {
    await withTestDb(async (tx) => {
      const project = await createTestProject(tx, {
        name: "No Briefs",
      });
      const history = await getEditorialBriefHistory(project.id, tx);
      expect(history).toEqual([]);
    });
  });
});
