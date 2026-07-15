// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { CorrectorSection } from "@/components/prompts/corrector-section";

const originalFetch = global.fetch;

describe("CorrectorSection", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("posts exact revision ID on correction trigger", async () => {
    const mockFetch = global.fetch as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

    const onCorrectingChange = vi.fn();
    const onGenerationCreated = vi.fn();

    const critiqueGen = {
      id: "critique-gen",
      status: "completed",
      assembledContent: "critique content",
      completedAt: "2026-01-01T00:00:00Z",
      generationMetadata: { type: "critique" },
      assemblyMetadata: null,
    };

    const assemblyGen = {
      id: "assembly-gen",
      status: "completed",
      assembledContent: "chapter content",
      completedAt: "2026-01-01T00:00:00Z",
      generationMetadata: null,
      assemblyMetadata: null,
    };

    const { rerender } = render(
      <CorrectorSection
        projectId="proj-1"
        chapterId="ch-1"
        generations={[critiqueGen, assemblyGen]}
        hasAssembly={true}
        onGenerationCreated={onGenerationCreated}
        correctorPromptRevisionId="corrector-rev"
        correctionTrigger={0}
        correctorModel="gpt-5.5"
        onCorrectingChange={onCorrectingChange}
      />,
    );

    rerender(
      <CorrectorSection
        projectId="proj-1"
        chapterId="ch-1"
        generations={[critiqueGen, assemblyGen]}
        hasAssembly={true}
        onGenerationCreated={onGenerationCreated}
        correctorPromptRevisionId="corrector-rev"
        correctionTrigger={1}
        correctorModel="gpt-5.5"
        onCorrectingChange={onCorrectingChange}
      />,
    );

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/projects/proj-1/chapters/ch-1/correct",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            correctorPromptRevisionId: "corrector-rev",
            critiqueGenerationId: "critique-gen",
            model: "gpt-5.5",
          }),
        }),
      );
    });
  });
});
