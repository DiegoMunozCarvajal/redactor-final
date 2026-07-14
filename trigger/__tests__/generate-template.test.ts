import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  update: vi.fn(),
  transaction: vi.fn(),
  generateCompletion: vi.fn(),
  getProviderForModel: vi.fn(),
  checkBlocklist: vi.fn(),
  assertOriginalEnough: vi.fn(),
}));

vi.mock("@trigger.dev/sdk", () => ({
  task: (config: unknown) => config,
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: (...args: unknown[]) => mocks.select(...args),
    update: (...args: unknown[]) => mocks.update(...args),
    transaction: (...args: unknown[]) => mocks.transaction(...args),
  },
}));

vi.mock("@/lib/ai/completion", () => ({
  generateCompletion: (...args: unknown[]) => mocks.generateCompletion(...args),
}));

vi.mock("@/lib/ai/providers", () => ({
  DEFAULT_GENERATION_MODEL: "test-model",
  getProviderForModel: (...args: unknown[]) => mocks.getProviderForModel(...args),
}));

vi.mock("@/lib/ai/originality-check", () => ({
  checkBlocklist: (...args: unknown[]) => mocks.checkBlocklist(...args),
  assertOriginalEnough: (...args: unknown[]) => mocks.assertOriginalEnough(...args),
}));

import { generateTemplate } from "@/trigger/generate-template";

type GenerateTemplateRunner = {
  run: (payload: {
    templateId: string;
    metaPromptId: string;
    chapters: Array<{
      chapterId: string;
      title: string;
      contentMd: string;
      position: number;
    }>;
    model?: string;
  }) => Promise<void>;
};

function selectResult<T>(rows: T[]) {
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue(rows),
      }),
    }),
  };
}

describe("generateTemplate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getProviderForModel.mockReturnValue("openai");
    mocks.checkBlocklist.mockReturnValue([]);
    mocks.assertOriginalEnough.mockReturnValue({ flagged: false });

    mocks.select
      .mockReturnValueOnce(selectResult([{ status: "generating" }]))
      .mockReturnValueOnce(
        selectResult([
          {
            id: "meta-1",
            content: "Sistema: {capitulo_en_markdown}",
            userPrompt: "Usuario: {{CAPITULO_CONTENIDO}}",
          },
        ]),
      );

    mocks.update.mockImplementation(() => ({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    }));

    const tx = {
      delete: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockResolvedValue(undefined),
      }),
    };
    mocks.transaction.mockImplementation(
      async (callback: (transaction: typeof tx) => Promise<void>) => callback(tx),
    );

    mocks.generateCompletion.mockResolvedValue({
      text: "",
      data: {
        templates: [
          {
            name: "Bloque",
            sourceContext: "",
            function: "Función",
            content: "Contenido original",
            placeholders: [],
            notes: "Notas",
          },
        ],
      },
      model: "test-model",
      provider: "openai",
      usage: {
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 2,
      },
    });
  });

  it("replaces any CAPITULO placeholder case-insensitively in all prompts", async () => {
    await (generateTemplate as unknown as GenerateTemplateRunner).run({
      templateId: "template-1",
      metaPromptId: "meta-1",
      chapters: [
        {
          chapterId: "chapter-1",
          title: "Título",
          contentMd: "Texto fuente",
          position: 0,
        },
      ],
      model: "test-model",
    });

    expect(mocks.generateCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        systemPrompt: "Sistema: # Título\n\nTexto fuente",
        userPrompt: "Usuario: # Título\n\nTexto fuente",
      }),
    );
  });
});
