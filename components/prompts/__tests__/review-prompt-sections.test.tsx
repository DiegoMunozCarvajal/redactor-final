// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CritiquePromptSection } from "@/components/prompts/critique-prompt-section";
import { CorrectorPromptSection } from "@/components/prompts/corrector-prompt-section";
import type { EffectiveReviewPrompt, ReviewPromptRevision } from "@/components/prompts/review-prompt-registry";

const critiqueRevisions: ReviewPromptRevision[] = [
  { id: "critique-v1", name: "Critique", versionLabel: "1.0", revisionNumber: 1, systemTemplate: "s1", userTemplate: "u1", requiredMarkers: [], outputContract: null },
  { id: "critique-v2", name: "Critique", versionLabel: "2.0", revisionNumber: 2, systemTemplate: "s2", userTemplate: "u2", requiredMarkers: [], outputContract: null },
];

const correctorRevisions: ReviewPromptRevision[] = [
  { id: "corrector-v1", name: "Corrector", versionLabel: "1.0", revisionNumber: 1, systemTemplate: "s1", userTemplate: "u1", requiredMarkers: [], outputContract: null },
  { id: "corrector-v2", name: "Corrector", versionLabel: "2.0", revisionNumber: 2, systemTemplate: "s2", userTemplate: "u2", requiredMarkers: [], outputContract: null },
];

const defaultCritique: EffectiveReviewPrompt = { ...critiqueRevisions[0], source: "global-default" };
const boundCorrector: EffectiveReviewPrompt = { ...correctorRevisions[1], source: "project-binding" };

function noop() {}

describe("CritiquePromptSection", () => {
  it("renders global default prompt with selector", () => {
    render(
      <CritiquePromptSection
        prompt={defaultCritique}
        revisions={critiqueRevisions}
        bindingRevisionId={null}
        defaultRevisionId="critique-v1"
        loading={false}
        error={null}
        saving={false}
        onRetry={noop}
        onRevisionChange={noop}
      />,
    );
    expect(screen.getByText("Critique v1.0")).toBeTruthy();
    expect(screen.getByText("Global default")).toBeTruthy();
  });

  it("renders project binding prompt with selector", () => {
    render(
      <CorrectorPromptSection
        prompt={boundCorrector}
        revisions={correctorRevisions}
        bindingRevisionId="corrector-v2"
        defaultRevisionId="corrector-v1"
        loading={false}
        error={null}
        saving={false}
        onRetry={noop}
        onRevisionChange={noop}
      />,
    );
    // Text appears in CardTitle AND SelectValue — use getAllByText
    expect(screen.getAllByText("Corrector v2.0").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Project binding")).toBeTruthy();
  });

  it("shows loading state", () => {
    render(
      <CritiquePromptSection
        prompt={null}
        revisions={[]}
        bindingRevisionId={null}
        defaultRevisionId={null}
        loading={true}
        error={null}
        saving={false}
        onRetry={noop}
        onRevisionChange={noop}
        onCritique={noop}
      />,
    );
    expect(screen.getByText("Loading critique prompt registry...")).toBeTruthy();
  });

  it("shows error with retry button", () => {
    const onRetry = vi.fn();
    render(
      <CritiquePromptSection
        prompt={null}
        revisions={[]}
        bindingRevisionId={null}
        defaultRevisionId={null}
        loading={false}
        error="Registry load failed"
        saving={false}
        onRetry={onRetry}
        onRevisionChange={noop}
      />,
    );
    expect(screen.getByText("Registry load failed")).toBeTruthy();
    fireEvent.click(screen.getByText("Retry"));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
