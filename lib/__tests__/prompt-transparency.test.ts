import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const root = new URL("../..", import.meta.url).pathname;

const rg = (pattern: string, paths: string[] = ["lib", "trigger", "app"]) => {
  const result = spawnSync(
    "rg",
    ["-n", pattern, ...paths, "--glob", "*.ts", "--glob", "*.tsx"],
    { cwd: root, encoding: "utf8" },
  );
  if (result.status !== 0 && result.status !== 1)
    throw new Error(result.stderr);
  return result.stdout;
};

describe("runtime prompt transparency", () => {
  it("has generateCompletion only in executor and completion modules", () => {
    const matches = rg("generateCompletion\\(")
      .split("\n")
      .filter(Boolean)
      .filter(
        (line) =>
          !line.includes("__tests__") &&
          !line.includes("lib/ai/completion.ts") &&
          !line.includes("lib/prompts/executor.ts"),
      );
    // Only executor and chapter-executor should call generateCompletion
    // in production code. chapter-executor composes messages manually but
    // delegates the actual API call to generateCompletion.
    const allowedCallers = [
      "lib/generate.ts", // Legacy functions pending deletion
      "lib/prompts/chapter-executor.ts", // Composes messages, delegates LLM call
    ];
    const violations = matches.filter(
      (line) => !allowedCallers.some((f) => line.includes(f)),
    );
    expect(
      violations,
      "generateCompletion() called outside executor/completion:\n" +
        violations.join("\n"),
    ).toEqual([]);
  });

  it("contains no embedded system prompt constants", () => {
    const sourceFiles = [
      "lib/generate.ts",
      "lib/editorial-brief/render.ts",
      "trigger/generate-template.ts",
    ];
    const source = sourceFiles
      .map((path) => {
        try {
          return readFileSync(`${root}/${path}`, "utf8");
        } catch {
          return "";
        }
      })
      .join("\n");

    const forbidden = [
      "DEFAULT_SYSTEM_PROMPT",
      "EXTRACTION_SYSTEM_PROMPT",
      "INDIVIDUAL_FILL_SYSTEM_PROMPT",
      "renderScopeInstructions",
      "<authority>",
      "Fallback: if no marker",
    ];

    for (const pattern of forbidden) {
      expect(
        source,
        `Forbidden pattern "${pattern}" found in production source`,
      ).not.toContain(pattern);
    }
  });

  it("has no hidden natural-language schema prose in completion module", () => {
    const completionSource = readFileSync(
      `${root}/lib/ai/completion.ts`,
      "utf8",
    );

    const forbidden = [
      "Return only a JSON object matching this schema",
      "jsonSuffix",
      "Responde ÚNICAMENTE con JSON",
    ];

    for (const pattern of forbidden) {
      expect(
        completionSource,
        `Forbidden schema prose "${pattern}" in completion.ts`,
      ).not.toContain(pattern);
    }
  });

  it("legacy prompt APIs return deprecation guidance", () => {
    // Verify legacy generationSystemPromptId writes are rejected
    const routeSource = readFileSync(
      `${root}/app/api/projects/[id]/route.ts`,
      "utf8",
    );
    expect(routeSource).toContain("generationSystemPromptId is deprecated");
    expect(routeSource).toContain("assemblyPromptId is deprecated");
  });
});
