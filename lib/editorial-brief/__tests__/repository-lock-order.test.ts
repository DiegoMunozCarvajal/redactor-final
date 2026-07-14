import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const repositorySource = readFileSync(
  new URL("../repository.ts", import.meta.url),
  "utf8",
);
const createRouteSource = readFileSync(
  new URL(
    "../../../app/api/projects/[id]/editorial-briefs/route.ts",
    import.meta.url,
  ),
  "utf8",
);

function functionBody(name: string, nextName: string): string {
  const start = repositorySource.indexOf(`export async function ${name}`);
  const end = repositorySource.indexOf(`export async function ${nextName}`, start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return repositorySource.slice(start, end);
}

describe("editorial brief repository lock discipline", () => {
  it("locks the project row before allocating a draft version", () => {
    const body = functionBody(
      "createEditorialBriefDraft",
      "replaceEditorialBriefDraft",
    );
    const projectLock = body.indexOf("lockProjectAndLoadChapterIds");
    const briefAccess = body.indexOf(".from(editorialBriefs)");

    expect(projectLock).toBeGreaterThanOrEqual(0);
    expect(briefAccess).toBeGreaterThan(projectLock);
    expect(body).not.toContain("23505");
    expect(body).not.toContain("retry");
  });

  it.each([
    ["replaceEditorialBriefDraft", "deleteEditorialBriefDraft"],
    ["deleteEditorialBriefDraft", "approveEditorialBrief"],
    ["approveEditorialBrief", "getEditorialBriefBundle"],
  ])("locks project before brief rows in %s", (name, nextName) => {
    const body = functionBody(name, nextName);
    expect(body.indexOf("lockProjectAndLoadChapterIds")).toBeGreaterThanOrEqual(0);
    expect(body.indexOf(".from(editorialBriefs)")).toBeGreaterThan(
      body.indexOf("lockProjectAndLoadChapterIds"),
    );
  });

  it("validates approval coverage before archiving current approved brief", () => {
    const body = functionBody(
      "approveEditorialBrief",
      "getEditorialBriefBundle",
    );
    expect(body.indexOf("assertExactChapterCoverage")).toBeGreaterThanOrEqual(0);
    expect(body.indexOf("status: \"archived\"")).toBeGreaterThan(
      body.indexOf("assertExactChapterCoverage"),
    );
  });

  it("reconciles clone contracts against current chapters", () => {
    expect(createRouteSource).toContain("reconcileChapterContracts(");
    expect(createRouteSource).toContain("createEmptyContract");
  });
});
