import { describe, expect, it, vi } from "vitest";
import { copyTemplatePromptsToChapter } from "@/lib/db/queries/copy-template-prompts";

describe("copyTemplatePromptsToChapter", () => {
  it("deduplicates placeholder names case-insensitively and stores lowercase", async () => {
    const promptSelect = {
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockResolvedValue([]),
        }),
      }),
    };
    const createdAt = new Date("2026-07-14T00:00:00.000Z");
    const placeholderSelect = {
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([
          {
            id: "11111111-1111-4111-8111-111111111111",
            chapterId: "22222222-2222-4222-8222-222222222222",
            name: "TEMA",
            definition: null,
            function: "first function",
            notes: "first notes",
            fillMetadata: null,
            createdAt,
          },
          {
            id: "33333333-3333-4333-8333-333333333333",
            chapterId: "22222222-2222-4222-8222-222222222222",
            name: "tema",
            definition: null,
            function: "second function",
            notes: "second notes",
            fillMetadata: null,
            createdAt,
          },
        ]),
      }),
    };
    const values = vi.fn().mockResolvedValue(undefined);
    const tx = {
      select: vi
        .fn()
        .mockReturnValueOnce(promptSelect)
        .mockReturnValueOnce(placeholderSelect),
      insert: vi.fn().mockReturnValue({ values }),
    };

    await copyTemplatePromptsToChapter(
      tx as unknown as Parameters<typeof copyTemplatePromptsToChapter>[0],
      "22222222-2222-4222-8222-222222222222",
      "44444444-4444-4444-8444-444444444444",
      "55555555-5555-4555-8555-555555555555",
    );

    expect(values).toHaveBeenCalledOnce();
    expect(values).toHaveBeenCalledWith([
      {
        chapterId: "55555555-5555-4555-8555-555555555555",
        name: "tema",
        function: "first function",
        notes: "first notes",
      },
    ]);
  });
});
