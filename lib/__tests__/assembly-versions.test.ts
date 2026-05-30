import { describe, expect, it } from "vitest";

import {
  getAssemblyVersions,
  getSelectedAssemblyVersion,
} from "@/lib/assembly-versions";

describe("assembly versions", () => {
  const generations = [
    {
      id: "fragment-only",
      status: "completed",
      assembledContent: null,
      completedAt: "2026-05-30T09:00:00.000Z",
      createdAt: "2026-05-30T08:59:00.000Z",
      assemblyMetadata: null,
    },
    {
      id: "assembly-v1",
      status: "completed",
      assembledContent: "old chapter",
      completedAt: "2026-05-30T10:00:00.000Z",
      createdAt: "2026-05-30T09:59:00.000Z",
      assemblyMetadata: { algorithm: "sequential" as const },
    },
    {
      id: "assembly-v2",
      status: "completed",
      assembledContent: "latest chapter",
      completedAt: "2026-05-30T11:00:00.000Z",
      createdAt: "2026-05-30T10:59:00.000Z",
      assemblyMetadata: { algorithm: "merge-sort" as const },
    },
  ];

  it("returns completed assembly versions newest first", () => {
    expect(getAssemblyVersions(generations).map((g) => g.id)).toEqual([
      "assembly-v2",
      "assembly-v1",
    ]);
  });

  it("selects latest assembly by default", () => {
    expect(getSelectedAssemblyVersion(generations)?.id).toBe("assembly-v2");
  });

  it("selects requested assembly version when available", () => {
    expect(getSelectedAssemblyVersion(generations, "assembly-v1")?.id).toBe("assembly-v1");
  });
});
