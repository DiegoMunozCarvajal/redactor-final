import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { db } from "@/lib/db";
import { projects, chapters, sources } from "@/lib/db/schema";
import {
  editorialBriefs,
  chapterEditorialContracts,
  editorialBriefSources,
} from "@/lib/db/schema/editorial-briefs";
import { chapterPlaceholders } from "@/lib/db/schema/chapter-placeholders";
import { eq, sql } from "drizzle-orm";
import {
  createTestBriefContent,
  createTestChapterContract,
} from "./fixtures";
import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/api/csrf", () => ({
  csrfCheck: vi.fn(),
}));

vi.mock("@/lib/editorial-brief/extract", () => ({
  extractEditorialBriefDraft: vi.fn(),
}));

// server-only is a Next.js build-time marker — noop in vitest
vi.mock("server-only", () => ({}));

import { createClient } from "@/lib/supabase/server";
import { csrfCheck } from "@/lib/api/csrf";
import { extractEditorialBriefDraft } from "@/lib/editorial-brief/extract";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTestRequest({
  method = "GET",
  url = "http://localhost:3000/api/test",
  body,
  headers = {},
}: {
  method?: string;
  url?: string;
  body?: unknown;
  headers?: Record<string, string>;
} = {}): NextRequest {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const init: any = {
    method,
    headers: { "Content-Type": "application/json", Origin: "http://localhost:3000", ...headers },
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  return new NextRequest(url, init);
}

function uid(): string {
  return crypto.randomUUID();
}

const USER_ID = "00000000-0000-0000-0000-000000000000";
const OTHER_USER_ID = "00000000-0000-0000-0000-000000000001";

const describeDb = process.env.TEST_DATABASE_URL ? describe : describe.skip;

// Helper: create a project with chapters and sources, return IDs for cleanup
async function setupProject(userId = USER_ID) {
  const projectId = uid();
  const ch1Id = uid();
  const ch2Id = uid();
  const sourceId = uid();

  await db.insert(projects).values({ id: projectId, userId, name: "Test", topic: "Test Topic" });
  await db.insert(chapters).values([
    { id: ch1Id, projectId, title: "Chapter 1", position: 1 },
    { id: ch2Id, projectId, title: "Chapter 2", position: 2 },
  ]);
  await db.insert(chapterPlaceholders).values([
    { chapterId: ch1Id, name: "tema" },
    { chapterId: ch2Id, name: "tema" },
  ]);
  await db.insert(sources).values({
    id: sourceId, projectId, fileName: "test.md", fileType: "markdown",
    sourceKind: "reference", extractedText: "Test content.", processed: false, chunkCount: 0,
  });

  return { projectId, ch1Id, ch2Id, sourceId };
}

async function cleanupProject(projectId: string) {
  // Delete in FK-safe order
  await db.delete(chapterPlaceholders).where(eq(chapterPlaceholders.chapterId, sql`(SELECT id FROM chapters WHERE project_id = ${projectId} LIMIT 1)`));
  // Simpler: delete all placeholders for chapters in this project
  const chIds = await db.select({ id: chapters.id }).from(chapters).where(eq(chapters.projectId, projectId));
  for (const ch of chIds) {
    await db.delete(chapterPlaceholders).where(eq(chapterPlaceholders.chapterId, ch.id));
  }
  await db.delete(editorialBriefSources).where(sql`editorial_brief_id IN (SELECT id FROM editorial_briefs WHERE project_id = ${projectId})`);
  await db.delete(chapterEditorialContracts).where(sql`editorial_brief_id IN (SELECT id FROM editorial_briefs WHERE project_id = ${projectId})`);
  await db.delete(editorialBriefs).where(eq(editorialBriefs.projectId, projectId));
  await db.delete(sources).where(eq(sources.projectId, projectId));
  await db.delete(chapters).where(eq(chapters.projectId, projectId));
  await db.delete(projects).where(eq(projects.id, projectId));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describeDb("editorial brief API routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } }, error: null }) },
    } as any);
    vi.mocked(csrfCheck).mockReturnValue(null);
  });

  // -----------------------------------------------------------------------
  // GET /api/projects/[id]/editorial-briefs
  // -----------------------------------------------------------------------

  describe("GET /api/projects/[id]/editorial-briefs", () => {
    let projectId: string;

    beforeAll(async () => {
      const s = await setupProject();
      projectId = s.projectId;
    });

    afterAll(async () => {
      await cleanupProject(projectId);
    });

    it("returns 401 when unauthenticated", async () => {
      vi.mocked(createClient).mockResolvedValue({
        auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }) },
      } as any);
      const { GET } = await import("@/app/api/projects/[id]/editorial-briefs/route");
      const req = createTestRequest();
      const res = await GET(req, { params: Promise.resolve({ id: projectId }) });
      expect(res.status).toBe(401);
    });

    it("returns 404 for non-existent project", async () => {
      const { GET } = await import("@/app/api/projects/[id]/editorial-briefs/route");
      const req = createTestRequest();
      const res = await GET(req, { params: Promise.resolve({ id: uid() }) });
      expect(res.status).toBe(404);
    });

    it("returns 404 for another user's project", async () => {
      const other = await setupProject(OTHER_USER_ID);
      const { GET } = await import("@/app/api/projects/[id]/editorial-briefs/route");
      const req = createTestRequest();
      const res = await GET(req, { params: Promise.resolve({ id: other.projectId }) });
      expect(res.status).toBe(404);
      await cleanupProject(other.projectId);
    });

    it("returns empty active/draft/history for project with no briefs", async () => {
      const { GET } = await import("@/app/api/projects/[id]/editorial-briefs/route");
      const req = createTestRequest();
      const res = await GET(req, { params: Promise.resolve({ id: projectId }) });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.active).toBeNull();
      expect(body.draft).toBeNull();
      expect(body.history).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // POST /api/projects/[id]/editorial-briefs  (create/clone)
  // -----------------------------------------------------------------------

  describe("POST /api/projects/[id]/editorial-briefs", () => {
    let projectId: string;

    beforeAll(async () => {
      const s = await setupProject();
      projectId = s.projectId;
    });

    afterAll(async () => {
      await cleanupProject(projectId);
    });

    it("returns 401 when unauthenticated", async () => {
      vi.mocked(createClient).mockResolvedValue({
        auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }) },
      } as any);
      const { POST } = await import("@/app/api/projects/[id]/editorial-briefs/route");
      const req = createTestRequest({ method: "POST", body: {} });
      const res = await POST(req, { params: Promise.resolve({ id: projectId }) });
      expect(res.status).toBe(401);
    });

    it("returns 404 for non-existent project", async () => {
      const { POST } = await import("@/app/api/projects/[id]/editorial-briefs/route");
      const req = createTestRequest({ method: "POST", body: {} });
      const res = await POST(req, { params: Promise.resolve({ id: uid() }) });
      expect(res.status).toBe(404);
    });

    it("creates a draft with contracts for all project chapters", async () => {
      const { POST } = await import("@/app/api/projects/[id]/editorial-briefs/route");
      const req = createTestRequest({ method: "POST", body: {} });
      const res = await POST(req, { params: Promise.resolve({ id: projectId }) });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.id).toBeTruthy();
      expect(body.version).toBe(1);
      expect(body.contracts.length).toBeGreaterThanOrEqual(1);
    });
  });

  // -----------------------------------------------------------------------
  // POST /api/projects/[id]/editorial-briefs/extract
  // -----------------------------------------------------------------------

  describe("POST /api/projects/[id]/editorial-briefs/extract", () => {
    let projectId: string;
    let sourceId: string;
    let ch1Id: string;
    let ch2Id: string;

    beforeAll(async () => {
      const s = await setupProject();
      projectId = s.projectId;
      sourceId = s.sourceId;
      ch1Id = s.ch1Id;
      ch2Id = s.ch2Id;
    });

    afterAll(async () => {
      await cleanupProject(projectId);
    });

    it("returns 401 when unauthenticated", async () => {
      vi.mocked(createClient).mockResolvedValue({
        auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }) },
      } as any);
      const { POST } = await import("@/app/api/projects/[id]/editorial-briefs/extract/route");
      const req = createTestRequest({ method: "POST", body: { sourceId } });
      const res = await POST(req, { params: Promise.resolve({ id: projectId }) });
      expect(res.status).toBe(401);
    });

    it("returns 400 for missing body", async () => {
      const { POST } = await import("@/app/api/projects/[id]/editorial-briefs/extract/route");
      const req = createTestRequest({ method: "POST" });
      const res = await POST(req, { params: Promise.resolve({ id: projectId }) });
      expect(res.status).toBe(400);
    });

    it("returns 404 for non-existent source", async () => {
      const { POST } = await import("@/app/api/projects/[id]/editorial-briefs/extract/route");
      const req = createTestRequest({ method: "POST", body: { sourceId: uid() } });
      const res = await POST(req, { params: Promise.resolve({ id: projectId }) });
      expect(res.status).toBe(404);
    });

    it("extracts a brief and creates a draft", async () => {
      const extractedBundle = {
        content: createTestBriefContent(),
        contracts: [createTestChapterContract(ch1Id), createTestChapterContract(ch2Id)],
        evidenceSourceIds: [],
      };
      vi.mocked(extractEditorialBriefDraft).mockResolvedValue(extractedBundle as any);

      const { POST } = await import("@/app/api/projects/[id]/editorial-briefs/extract/route");
      const req = createTestRequest({ method: "POST", body: { sourceId } });
      const res = await POST(req, { params: Promise.resolve({ id: projectId }) });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.id).toBeTruthy();
      expect(body.contracts.length).toBe(2);

      expect(vi.mocked(extractEditorialBriefDraft)).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceText: "Test content.",
          projectTopic: "Test Topic",
        }),
      );
    });
  });

  // -----------------------------------------------------------------------
  // GET / PATCH / DELETE /api/projects/[id]/editorial-briefs/[briefId]
  // -----------------------------------------------------------------------

  describe("GET /api/projects/[id]/editorial-briefs/[briefId]", () => {
    let projectId: string;
    let ch1Id: string;

    beforeAll(async () => {
      const s = await setupProject();
      projectId = s.projectId;
      ch1Id = s.ch1Id;
    });

    afterAll(async () => {
      await cleanupProject(projectId);
    });

    it("returns 401 when unauthenticated", async () => {
      vi.mocked(createClient).mockResolvedValue({
        auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }) },
      } as any);
      const { GET } = await import("@/app/api/projects/[id]/editorial-briefs/[briefId]/route");
      const req = createTestRequest();
      const res = await GET(req, { params: Promise.resolve({ id: projectId, briefId: uid() }) });
      expect(res.status).toBe(401);
    });

    it("returns 404 for non-existent brief", async () => {
      const { GET } = await import("@/app/api/projects/[id]/editorial-briefs/[briefId]/route");
      const req = createTestRequest();
      const res = await GET(req, { params: Promise.resolve({ id: projectId, briefId: uid() }) });
      expect(res.status).toBe(404);
    });
  });

  describe("PATCH /api/projects/[id]/editorial-briefs/[briefId]", () => {
    let projectId: string;
    let ch1Id: string;

    beforeAll(async () => {
      const s = await setupProject();
      projectId = s.projectId;
      ch1Id = s.ch1Id;
    });

    afterAll(async () => {
      await cleanupProject(projectId);
    });

    it("returns 401 when unauthenticated", async () => {
      vi.mocked(createClient).mockResolvedValue({
        auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }) },
      } as any);
      const { PATCH } = await import("@/app/api/projects/[id]/editorial-briefs/[briefId]/route");
      const req = createTestRequest({ method: "PATCH", body: { content: createTestBriefContent(), contracts: [createTestChapterContract(ch1Id)], evidenceSourceIds: [] } });
      const res = await PATCH(req, { params: Promise.resolve({ id: projectId, briefId: uid() }) });
      expect(res.status).toBe(401);
    });

    it("returns 400 for invalid body", async () => {
      const { PATCH } = await import("@/app/api/projects/[id]/editorial-briefs/[briefId]/route");
      const req = createTestRequest({ method: "PATCH", body: { invalid: true } });
      const res = await PATCH(req, { params: Promise.resolve({ id: projectId, briefId: uid() }) });
      expect(res.status).toBe(400);
    });

    it("returns 404 for non-existent brief", async () => {
      const { PATCH } = await import("@/app/api/projects/[id]/editorial-briefs/[briefId]/route");
      const req = createTestRequest({ method: "PATCH", body: { content: createTestBriefContent(), contracts: [createTestChapterContract(ch1Id)], evidenceSourceIds: [] } });
      const res = await PATCH(req, { params: Promise.resolve({ id: projectId, briefId: uid() }) });
      expect(res.status).toBe(404);
    });
  });

  describe("DELETE /api/projects/[id]/editorial-briefs/[briefId]", () => {
    let projectId: string;

    beforeAll(async () => {
      const s = await setupProject();
      projectId = s.projectId;
    });

    afterAll(async () => {
      await cleanupProject(projectId);
    });

    it("returns 401 when unauthenticated", async () => {
      vi.mocked(createClient).mockResolvedValue({
        auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }) },
      } as any);
      const { DELETE } = await import("@/app/api/projects/[id]/editorial-briefs/[briefId]/route");
      const req = createTestRequest({ method: "DELETE" });
      const res = await DELETE(req, { params: Promise.resolve({ id: projectId, briefId: uid() }) });
      expect(res.status).toBe(401);
    });

    it("returns 404 for non-existent brief", async () => {
      const { DELETE } = await import("@/app/api/projects/[id]/editorial-briefs/[briefId]/route");
      const req = createTestRequest({ method: "DELETE" });
      const res = await DELETE(req, { params: Promise.resolve({ id: projectId, briefId: uid() }) });
      expect(res.status).toBe(404);
    });
  });

  // -----------------------------------------------------------------------
  // POST /api/projects/[id]/editorial-briefs/[briefId]/approve
  // -----------------------------------------------------------------------

  describe("POST /api/projects/[id]/editorial-briefs/[briefId]/approve", () => {
    let projectId: string;

    beforeAll(async () => {
      const s = await setupProject();
      projectId = s.projectId;
    });

    afterAll(async () => {
      await cleanupProject(projectId);
    });

    it("returns 401 when unauthenticated", async () => {
      vi.mocked(createClient).mockResolvedValue({
        auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }) },
      } as any);
      const { POST } = await import("@/app/api/projects/[id]/editorial-briefs/[briefId]/approve/route");
      const req = createTestRequest({ method: "POST" });
      const res = await POST(req, { params: Promise.resolve({ id: projectId, briefId: uid() }) });
      expect(res.status).toBe(401);
    });

    it("returns 404 for non-existent brief", async () => {
      const { POST } = await import("@/app/api/projects/[id]/editorial-briefs/[briefId]/approve/route");
      const req = createTestRequest({ method: "POST" });
      const res = await POST(req, { params: Promise.resolve({ id: projectId, briefId: uid() }) });
      expect(res.status).toBe(404);
    });
  });

  // -----------------------------------------------------------------------
  // Full lifecycle: create -> PATCH -> approve -> list
  // -----------------------------------------------------------------------

  describe("full lifecycle", () => {
    let projectId: string;

    beforeAll(async () => {
      const s = await setupProject();
      projectId = s.projectId;
    });

    afterAll(async () => {
      await cleanupProject(projectId);
    });

    it("create draft -> PATCH -> approve -> GET list", async () => {
      const { POST: createPost } = await import("@/app/api/projects/[id]/editorial-briefs/route");
      const { PATCH } = await import("@/app/api/projects/[id]/editorial-briefs/[briefId]/route");
      const { GET: listGet } = await import("@/app/api/projects/[id]/editorial-briefs/route");
      const { POST: approvePost } = await import("@/app/api/projects/[id]/editorial-briefs/[briefId]/approve/route");

      // 1. Create draft
      const cRes = await createPost(createTestRequest({ method: "POST", body: {} }), { params: Promise.resolve({ id: projectId }) });
      expect(cRes.status).toBe(201);
      const draft = await cRes.json();

      // 2. PATCH
      const updatedContent = createTestBriefContent({ market: { region: "Mexico" } });
      const pRes = await PATCH(
        createTestRequest({ method: "PATCH", body: { content: updatedContent, contracts: draft.contracts, evidenceSourceIds: [] } }),
        { params: Promise.resolve({ id: projectId, briefId: draft.id }) },
      );
      expect(pRes.status).toBe(200);

      // 3. Approve
      const aRes = await approvePost(createTestRequest({ method: "POST" }), { params: Promise.resolve({ id: projectId, briefId: draft.id }) });
      expect(aRes.status).toBe(200);

      // 4. GET list
      const lRes = await listGet(createTestRequest(), { params: Promise.resolve({ id: projectId }) });
      expect(lRes.status).toBe(200);
      const list = await lRes.json();
      expect(list.active).not.toBeNull();
      expect(list.active.id).toBe(draft.id);
      expect(list.history.length).toBeGreaterThanOrEqual(1);
    });
  });

  // -----------------------------------------------------------------------
  // Source FK 409 on DELETE
  // -----------------------------------------------------------------------

  describe("source deletion FK protection", () => {
    it("returns 409 when deleting a source linked to an editorial brief", async () => {
      const s = await setupProject();
      const briefId = uid();
      const srcId = uid();

      // Create a second source to link
      await db.insert(sources).values({
        id: srcId, projectId: s.projectId, fileName: "linked.md", fileType: "markdown",
        sourceKind: "reference", extractedText: "Linked.", processed: false, chunkCount: 0,
      });

      // Create brief via route
      const { POST } = await import("@/app/api/projects/[id]/editorial-briefs/route");
      const cRes = await POST(createTestRequest({ method: "POST", body: {} }), { params: Promise.resolve({ id: s.projectId }) });
      // We just need a brief that has this source bound - use direct DB for the binding
      if (cRes.status === 201) {
        const brief = await cRes.json();
        await db.insert(editorialBriefSources).values({ editorialBriefId: brief.id, sourceId: srcId });
      }

      // Try to delete the linked source
      const { DELETE: deleteSource } = await import("@/app/api/projects/[id]/sources/[sourceId]/route");
      const res = await deleteSource(createTestRequest({ method: "DELETE" }), { params: Promise.resolve({ id: s.projectId, sourceId: srcId }) });
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error).toContain("brief editorial");

      await cleanupProject(s.projectId);
    });
  });
});
