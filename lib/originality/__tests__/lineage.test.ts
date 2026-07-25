import { describe, expect, it } from "vitest";
import {
  templateLineage,
  sourceFreeLineage,
  isOriginalityLineageCurrent,
} from "../lineage";

const baseTemplate = {
  pipelineRunId: "run-1",
  pipelineVersion: "template-pipeline-v2",
  compilerVersion: "template-compiler-v1",
  compilerHash: "abc123",
  recipeCatalogHash: "def456",
  templateArtifactHash: "ghi789",
  sourceProfileVersion: "source-profile-v1",
  sourceProfileSetHash: "profile-set-hash",
  originalityPolicyVersion: "originality-policy-v2",
  promptRevisions: {
    "chapter-content": "chapter-v1",
    "generation-system": "system-v1",
  },
};

describe("isOriginalityLineageCurrent", () => {
  it("returns true for identical template lineages", () => {
    const a = templateLineage(baseTemplate);
    const b = templateLineage(baseTemplate);
    expect(isOriginalityLineageCurrent(a, b)).toBe(true);
  });

  it("compares the complete canonical prompt revision map", () => {
    const oldLineage = templateLineage({
      ...baseTemplate,
      promptRevisions: {
        "chapter-content": "chapter-v1",
        "generation-system": "system-v1",
      },
    });
    const current = templateLineage({
      ...baseTemplate,
      promptRevisions: {
        "chapter-content": "chapter-v1",
        "generation-system": "system-v2",
      },
    });
    expect(isOriginalityLineageCurrent(oldLineage, current)).toBe(false);
  });

  it("never treats missing legacy lineage as current", () => {
    expect(isOriginalityLineageCurrent(null, sourceFreeLineage())).toBe(false);
  });

  it("never treats undefined lineage as current", () => {
    expect(
      isOriginalityLineageCurrent(undefined, templateLineage(baseTemplate)),
    ).toBe(false);
  });

  it("compilerHash change makes lineage stale", () => {
    const oldLineage = templateLineage(baseTemplate);
    const current = templateLineage({
      ...baseTemplate,
      compilerHash: "different-hash",
    });
    expect(isOriginalityLineageCurrent(oldLineage, current)).toBe(false);
  });

  it("policy version change makes lineage stale", () => {
    const oldLineage = templateLineage(baseTemplate);
    const current = templateLineage({
      ...baseTemplate,
      originalityPolicyVersion: "originality-policy-v3",
    });
    expect(isOriginalityLineageCurrent(oldLineage, current)).toBe(false);
  });

  it("source-free lineages with same revisions are current", () => {
    const a = sourceFreeLineage({
      promptRevisions: { "generation-system": "v1" },
    });
    const b = sourceFreeLineage({
      promptRevisions: { "generation-system": "v1" },
    });
    expect(isOriginalityLineageCurrent(a, b)).toBe(true);
  });

  it("prompt revision order independence", () => {
    const a = templateLineage({
      ...baseTemplate,
      promptRevisions: {
        "generation-system": "system-v1",
        "chapter-content": "chapter-v1",
      },
    });
    const b = templateLineage({
      ...baseTemplate,
      promptRevisions: {
        "chapter-content": "chapter-v1",
        "generation-system": "system-v1",
      },
    });
    expect(isOriginalityLineageCurrent(a, b)).toBe(true);
  });
});
