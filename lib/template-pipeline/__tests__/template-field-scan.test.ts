import { describe, expect, it } from "vitest";
import {
  collectTemplateFields,
  assertTemplateFieldsClean,
  type TemplateBlockLike,
} from "../template-field-scan";

function cleanBlock(
  overrides: Partial<TemplateBlockLike> = {},
): TemplateBlockLike {
  return {
    name: "Test Block",
    content: "Contenido genérico sin contaminación.",
    userPrompt: "Escribe una explicación sobre el tema.",
    function: "explicar",
    placeholders: [
      { name: "concepto_1", function: "definir concepto clave" },
    ],
    ...overrides,
  };
}

describe("collectTemplateFields", () => {
  it("flattens every relevant field", () => {
    const fields = collectTemplateFields([cleanBlock()]);
    expect(fields).toEqual([
      { path: "templates[0].name", value: "Test Block" },
      { path: "templates[0].content", value: "Contenido genérico sin contaminación." },
      { path: "templates[0].userPrompt", value: "Escribe una explicación sobre el tema." },
      { path: "templates[0].function", value: "explicar" },
      { path: "templates[0].placeholders[0].name", value: "concepto_1" },
      { path: "templates[0].placeholders[0].function", value: "definir concepto clave" },
    ]);
  });

  it("includes sourceContext and notes when present", () => {
    const fields = collectTemplateFields([
      cleanBlock({
        sourceContext: "source reference",
        notes: "some notes",
      }),
    ]);
    expect(fields).toContainEqual({
      path: "templates[0].sourceContext",
      value: "source reference",
    });
    expect(fields).toContainEqual({
      path: "templates[0].notes",
      value: "some notes",
    });
  });

  it("skips null/undefined optional fields", () => {
    const fields = collectTemplateFields([
      cleanBlock({ function: null, sourceContext: undefined }),
    ]);
    const paths = fields.map((f) => f.path);
    expect(paths).not.toContain("templates[0].function");
    expect(paths).not.toContain("templates[0].sourceContext");
  });
});

describe("assertTemplateFieldsClean", () => {
  it("passes clean blocks", () => {
    expect(() =>
      assertTemplateFieldsClean([cleanBlock()]),
    ).not.toThrow();
  });

  it("throws on contaminated placeholder function", () => {
    const block = cleanBlock();
    block.placeholders[0].function =
      "La analogía del hielo que se derrite con calor gradual";
    expect(() => assertTemplateFieldsClean([block])).toThrow();
  });

  it("throws on contaminated content", () => {
    expect(() =>
      assertTemplateFieldsClean([
        cleanBlock({
          content: "Los hábitos atómicos son la clave del éxito.",
        }),
      ]),
    ).toThrow();
  });
});
