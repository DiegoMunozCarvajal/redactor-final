import { describe, expect, it, vi } from "vitest";
import {
  clearReviewPromptBinding,
  loadReviewPromptRegistry,
  setReviewPromptBinding,
} from "@/components/prompts/review-prompt-registry";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("loadReviewPromptRegistry", () => {
  it("resolves project binding before global default and default otherwise", async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/prompt-bindings")) {
        return json([{ kind: "critique", promptRevisionId: "critique-bound" }]);
      }
      if (url.includes("kind=critique")) {
        return json([{ id: "critique-def", name: "Critique", defaultRevisionId: "critique-default" }]);
      }
      if (url.includes("kind=corrector")) {
        return json([{ id: "corrector-def", name: "Corrector", defaultRevisionId: "corrector-default" }]);
      }
      if (url.endsWith("/critique-def/revisions")) {
        return json([
          { id: "critique-bound", versionLabel: "2.0", revisionNumber: 2, systemTemplate: "s2", userTemplate: "u2", requiredMarkers: [], outputContract: null },
          { id: "critique-default", versionLabel: "1.0", revisionNumber: 1, systemTemplate: "s1", userTemplate: "u1", requiredMarkers: [], outputContract: null },
        ]);
      }
      if (url.endsWith("/corrector-def/revisions")) {
        return json([{ id: "corrector-default", versionLabel: "1.0", revisionNumber: 1, systemTemplate: "s", userTemplate: "u", requiredMarkers: [], outputContract: null }]);
      }
      return json({ error: "not found" }, 404);
    });

    const result = await loadReviewPromptRegistry("project-1", fetcher as typeof fetch);

    expect(result.critique.effective).toMatchObject({ id: "critique-bound", source: "project-binding" });
    expect(result.critique.bindingRevisionId).toBe("critique-bound");
    expect(result.corrector.effective).toMatchObject({ id: "corrector-default", source: "global-default" });
    expect(result.corrector.bindingRevisionId).toBeNull();
  });

  it("rejects unavailable configured revisions", async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/prompt-bindings")) return json([]);
      if (url.includes("kind=critique")) return json([{ id: "d1", name: "Critique", defaultRevisionId: "missing" }]);
      if (url.includes("kind=corrector")) return json([]);
      if (url.endsWith("/d1/revisions")) return json([]);
      return json({ error: "not found" }, 404);
    });

    await expect(loadReviewPromptRegistry("project-1", fetcher as typeof fetch)).rejects.toThrow(
      "Configured critique revision missing is unavailable",
    );
  });
});

describe("review prompt binding mutations", () => {
  it("persists an exact project revision", async () => {
    const fetcher = vi.fn(async () => json({ ok: true }));
    await setReviewPromptBinding("project-1", "critique", "revision-1", fetcher as typeof fetch);
    expect(fetcher).toHaveBeenCalledWith(
      "/api/projects/project-1/prompt-bindings",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ kind: "critique", promptRevisionId: "revision-1" }),
      }),
    );
  });

  it("clears project binding to restore global default", async () => {
    const fetcher = vi.fn(async () => json({ ok: true }));
    await clearReviewPromptBinding("project-1", "corrector", fetcher as typeof fetch);
    expect(fetcher).toHaveBeenCalledWith(
      "/api/projects/project-1/prompt-bindings?kind=corrector",
      { method: "DELETE" },
    );
  });
});
