/**
 * @vitest-environment jsdom
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AssemblyPromptSection } from "@/components/prompts/assembly-prompt-section";

const planner = {
  id: "planner-rev",
  name: "Assembly Planner",
  versionLabel: "1.0",
  systemTemplate: "Planifica usando {{SECCIONES_GENERADAS}}.",
  userTemplate: "Contexto: {{EDITORIAL_CONTEXT}}",
  requiredMarkers: ["{{SECCIONES_GENERADAS}}"],
  outputContract: "JSON",
  source: "global-default",
};

const assembler = {
  id: "assembly-rev",
  name: "Assembly Prompt",
  versionLabel: "1.3",
  systemTemplate: "Ensambla según {{ASSEMBLY_PLAN}}.",
  userTemplate: "Fragmentos: {{SECCIONES_GENERADAS}}",
  requiredMarkers: ["{{ASSEMBLY_PLAN}}"],
  outputContract: null,
  source: "project-binding",
};

const PipelineSection = AssemblyPromptSection as unknown as ComponentType<Record<string, unknown>>;

afterEach(cleanup);

describe("AssemblyPromptSection", () => {
  it("shows planner before assembler with effective revisions", () => {
    render(
      <PipelineSection
        planner={planner}
        assembler={assembler}
        loading={false}
        error={null}
        onRetry={vi.fn()}
        onAssemble={vi.fn()}
        assembling={false}
        canAssemble
      />,
    );

    const plannerLabel = screen.getByText("Planner");
    const assemblerLabel = screen.getByText("Assembler");

    expect(plannerLabel.compareDocumentPosition(assemblerLabel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText("Assembly Planner v1.0")).toBeTruthy();
    expect(screen.getByText("Assembly Prompt v1.3")).toBeTruthy();
    expect(screen.getByText("Global default")).toBeTruthy();
    expect(screen.getByText("Project binding")).toBeTruthy();
  });

  it("shows effective prompt content in read-only preview", () => {
    render(
      <PipelineSection
        planner={planner}
        assembler={assembler}
        loading={false}
        error={null}
        onRetry={vi.fn()}
        onAssemble={vi.fn()}
        assembling={false}
        canAssemble
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "View planner prompt" }));

    expect(screen.getByText("Planifica usando {{SECCIONES_GENERADAS}}.")).toBeTruthy();
    expect(screen.getByText("Contexto: {{EDITORIAL_CONTEXT}}")).toBeTruthy();
    expect(screen.getByText("JSON")).toBeTruthy();
  });

  it("keeps pipeline visible and offers retry after load failure", () => {
    const onRetry = vi.fn();
    render(
      <PipelineSection
        planner={null}
        assembler={null}
        loading={false}
        error="Could not load effective prompts"
        onRetry={onRetry}
        onAssemble={vi.fn()}
        assembling={false}
        canAssemble
      />,
    );

    expect(screen.getByText("Assembly pipeline")).toBeTruthy();
    expect(screen.getByText("Could not load effective prompts")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("labels an explicit per-run revision as a run override", () => {
    render(
      <PipelineSection
        planner={{ ...planner, source: "run-override" }}
        assembler={assembler}
        loading={false}
        error={null}
        onRetry={vi.fn()}
        onAssemble={vi.fn()}
        assembling={false}
        canAssemble
      />,
    );

    expect(screen.getByText("Run override")).toBeTruthy();
  });
});

describe("loadAssemblyPipelineData", () => {
  it("resolves project binding before global default for both stages", async () => {
    const mod = await import("@/components/prompts/assembly-prompt-section");
    expect(typeof (mod as Record<string, unknown>).loadAssemblyPipelineData).toBe("function");

    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/prompt-bindings")) {
        return new Response(JSON.stringify([
          {
            kind: "assembly-planner",
            promptRevisionId: "planner-rev",
            versionLabel: "1.0",
            definitionName: "Assembly Planner",
          },
        ]), { status: 200 });
      }
      if (url.includes("kind=assembly-planner")) {
        return new Response(JSON.stringify([
          { id: "planner-def", name: "Assembly Planner", defaultRevisionId: "planner-old" },
        ]), { status: 200 });
      }
      if (url.includes("kind=assembly")) {
        return new Response(JSON.stringify([
          { id: "assembly-def", name: "Assembly Prompt", defaultRevisionId: "assembly-rev" },
        ]), { status: 200 });
      }
      if (url.endsWith("/planner-def/revisions")) {
        return new Response(JSON.stringify([
          { ...planner, revisionNumber: 1 },
          { ...planner, id: "planner-old", versionLabel: "0.9", revisionNumber: 0 },
        ]), { status: 200 });
      }
      if (url.endsWith("/assembly-def/revisions")) {
        return new Response(JSON.stringify([{ ...assembler, revisionNumber: 3 }]), { status: 200 });
      }
      return new Response(null, { status: 404 });
    });

    const load = (mod as unknown as {
      loadAssemblyPipelineData: (projectId: string, fetcher: typeof fetch) => Promise<{
        planner: typeof planner;
        assembler: typeof assembler;
      }>;
    }).loadAssemblyPipelineData;
    const result = await load("project-1", fetcher as unknown as typeof fetch);

    expect(result.planner).toMatchObject({ id: "planner-rev", source: "project-binding" });
    expect(result.assembler).toMatchObject({ id: "assembly-rev", source: "global-default" });
  });

  it("rejects failed registry requests instead of hiding selectors", async () => {
    const mod = await import("@/components/prompts/assembly-prompt-section");
    expect(typeof (mod as Record<string, unknown>).loadAssemblyPipelineData).toBe("function");
    const load = (mod as unknown as {
      loadAssemblyPipelineData: (projectId: string, fetcher: typeof fetch) => Promise<unknown>;
    }).loadAssemblyPipelineData;
    const fetcher = vi.fn(async () => new Response(null, { status: 503 }));

    await expect(load("project-1", fetcher as unknown as typeof fetch)).rejects.toThrow(
      "Could not load assembly prompt registry",
    );
  });
});
