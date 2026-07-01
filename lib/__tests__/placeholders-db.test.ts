import { describe, it, expect, vi } from "vitest";

// Must mock BEFORE importing — lib/placeholders.ts imports db from @/lib/db
// which initializes a drizzle client requiring DATABASE_URL.
vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(),
    update: vi.fn(),
    transaction: vi.fn(),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  chapterPlaceholders: {},
}));

import { resolvePlaceholdersDirect } from "@/lib/placeholders";

describe("resolvePlaceholdersDirect", () => {
  it("resolves tema placeholders from project topic", () => {
    const { resolved, unresolved } = resolvePlaceholdersDirect(
      ["tema", "tema_del_libro", "autor"],
      "Hábitos Atómicos",
    );
    expect(resolved).toEqual({
      tema: "Hábitos Atómicos",
      tema_del_libro: "Hábitos Atómicos",
    });
    expect(unresolved).toEqual(["autor"]);
  });

  it("resolves topic variants", () => {
    const { resolved } = resolvePlaceholdersDirect(
      ["main_topic", "topic_del_libro"],
      "Productividad",
    );
    expect(resolved).toEqual({
      main_topic: "Productividad",
      topic_del_libro: "Productividad",
    });
  });

  it("no false positive on 'sistema' — split by underscore avoids substring match", () => {
    const { resolved, unresolved } = resolvePlaceholdersDirect(
      ["sistema", "tema"],
      "Foo",
    );
    expect(resolved).toEqual({ tema: "Foo" });
    expect(unresolved).toEqual(["sistema"]);
  });

  it("classifies lector/audiencia as unresolved (needs LLM)", () => {
    const { unresolved } = resolvePlaceholdersDirect(
      ["lector_objetivo", "audiencia", "tema"],
      "Foo",
    );
    expect(unresolved).toContain("lector_objetivo");
    expect(unresolved).toContain("audiencia");
    expect(unresolved).not.toContain("tema");
  });

  it("all unresolved when no project topic", () => {
    const { resolved, unresolved } = resolvePlaceholdersDirect(
      ["tema", "autor", "metodologia"],
      null,
    );
    expect(resolved).toEqual({});
    expect(unresolved).toEqual(["tema", "autor", "metodologia"]);
  });

  it("empty names returns empty resolved and unresolved", () => {
    const { resolved, unresolved } = resolvePlaceholdersDirect([], "Topic");
    expect(resolved).toEqual({});
    expect(unresolved).toEqual([]);
  });
});
