import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { mockDb, mockTx, mockCreateClient, mockCsrfCheck } = vi.hoisted(() => {
  const mockTx = {
    select: vi.fn(),
    delete: vi.fn(),
  };
  return {
    mockDb: {
      select: vi.fn(),
      transaction: vi.fn(),
    },
    mockTx,
    mockCreateClient: vi.fn(),
    mockCsrfCheck: vi.fn(),
  };
});

vi.mock("@/lib/db", () => ({ db: mockDb }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mockCreateClient }));
vi.mock("@/lib/api/csrf", () => ({ csrfCheck: mockCsrfCheck }));
vi.mock("@/lib/editorial-brief/context", () => ({
  loadEditorialBundle: vi.fn(),
}));

function selectBuilder(result: unknown[]) {
  const builder = {
    from: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
  };
  builder.from.mockReturnValue(builder);
  builder.where.mockReturnValue(builder);
  builder.limit.mockResolvedValue(result);
  return builder;
}

function deleteBuilder(result: Promise<unknown>) {
  return { where: vi.fn().mockReturnValue(result) };
}

describe("DELETE chapter with editorial history", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCsrfCheck.mockReturnValue(null);
    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "owner-id" } },
        }),
      },
    });

    const outerResults = [
      [{ id: "project-id", userId: "owner-id" }],
      [{ id: "chapter-id" }],
    ];
    mockDb.select.mockImplementation(() =>
      selectBuilder(outerResults.shift() ?? []),
    );
    mockTx.select.mockImplementation(() =>
      selectBuilder([{ id: "contract-id" }]),
    );
    mockTx.delete.mockImplementation(() =>
      deleteBuilder(Promise.resolve(undefined)),
    );
    mockDb.transaction.mockImplementation(
      async (callback: (tx: typeof mockTx) => Promise<unknown>) =>
        callback(mockTx),
    );
  });

  it("returns stable 409 before deleting related records", async () => {
    const { DELETE } = await import(
      "@/app/api/projects/[id]/chapters/[chapterId]/route"
    );
    const request = new NextRequest(
      "http://localhost:3000/api/projects/project-id/chapters/chapter-id",
      {
        method: "DELETE",
        headers: { origin: "http://localhost:3000" },
      },
    );

    const response = await DELETE(request, {
      params: Promise.resolve({ id: "project-id", chapterId: "chapter-id" }),
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "chapter has editorial history",
      code: "chapter_has_editorial_history",
    });
    expect(mockTx.delete).not.toHaveBeenCalled();
  });

  it("maps a concurrent editorial FK conflict to the same stable 409", async () => {
    mockTx.select.mockImplementation(() => selectBuilder([]));
    const constraintError = Object.assign(new Error("foreign key violation"), {
      code: "23503",
      constraint_name:
        "chapter_editorial_contracts_chapter_id_restrict_fk",
    });
    const deleteResults = [
      Promise.resolve(undefined),
      Promise.resolve(undefined),
      Promise.reject(constraintError),
    ];
    mockTx.delete.mockImplementation(() =>
      deleteBuilder(deleteResults.shift() ?? Promise.resolve(undefined)),
    );

    const { DELETE } = await import(
      "@/app/api/projects/[id]/chapters/[chapterId]/route"
    );
    const request = new NextRequest(
      "http://localhost:3000/api/projects/project-id/chapters/chapter-id",
      {
        method: "DELETE",
        headers: { origin: "http://localhost:3000" },
      },
    );

    const response = await DELETE(request, {
      params: Promise.resolve({ id: "project-id", chapterId: "chapter-id" }),
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "chapter_has_editorial_history",
    });
  });
});
