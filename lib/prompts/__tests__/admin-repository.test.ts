import { describe, expect, it } from "vitest";
import { withTestDb } from "@/lib/__tests__/helpers/db";
import { createTestProject } from "@/lib/__tests__/helpers/fixtures";
import {
  llmPromptExecutions,
  projectPromptBindings,
  promptDefaults,
  promptDefinitions,
  promptRevisions,
} from "@/lib/db/schema";
import {
  getPromptDefinitionDetail,
  listPromptDefinitionSummaries,
  setPromptDefinitionArchived,
  getArchiveBlockers,
} from "@/lib/prompts/admin-repository";
import type { DB } from "@/lib/prompts/admin-repository";

describe("prompt admin repository", () => {
  it("returns latest, exact older default, bindings, and execution attempts", async () => {
    await withTestDb(async (tx) => {
      const ctx = tx as unknown as DB;
      const project = await createTestProject(tx, { name: "Prompt usage" });
      const [definition] = await tx
        .insert(promptDefinitions)
        .values({
          kind: "assembly",
          name: "Assembly test",
        })
        .returning();
      const revisions = await tx
        .insert(promptRevisions)
        .values([
          {
            promptDefinitionId: definition.id,
            revisionNumber: 1,
            versionLabel: "1.0",
            systemTemplate: "{{EDITORIAL_CONTEXT}}",
            userTemplate: "{{ASSEMBLY_PLAN}} {{SECCIONES_GENERADAS}}",
            requiredMarkers: [
              "{{EDITORIAL_CONTEXT}}",
              "{{ASSEMBLY_PLAN}}",
              "{{SECCIONES_GENERADAS}}",
            ],
            configuration: {},
          },
          {
            promptDefinitionId: definition.id,
            revisionNumber: 2,
            versionLabel: "1.1",
            systemTemplate: "{{EDITORIAL_CONTEXT}} revised",
            userTemplate: "{{ASSEMBLY_PLAN}} {{SECCIONES_GENERADAS}}",
            requiredMarkers: [
              "{{EDITORIAL_CONTEXT}}",
              "{{ASSEMBLY_PLAN}}",
              "{{SECCIONES_GENERADAS}}",
            ],
            configuration: {},
          },
        ])
        .returning();
      await tx
        .insert(promptDefaults)
        .values({
          kind: "assembly",
          promptRevisionId: revisions[0].id,
        })
        .onConflictDoUpdate({
          target: promptDefaults.kind,
          set: { promptRevisionId: revisions[0].id },
        });
      await tx.insert(projectPromptBindings).values({
        projectId: project.id,
        kind: "assembly",
        promptRevisionId: revisions[1].id,
      });
      await tx.insert(llmPromptExecutions).values([
        {
          stage: "assembly",
          promptRevisionId: revisions[0].id,
          model: "test",
          provider: "test",
          messages: [],
          status: "completed",
        },
        {
          stage: "assembly",
          promptRevisionId: revisions[1].id,
          model: "test",
          provider: "test",
          messages: [],
          status: "failed",
        },
      ]);

      const summaries = await listPromptDefinitionSummaries({ kind: "assembly" }, ctx);
      const ours = summaries.filter((s) => s.id === definition.id);
      expect(ours.length).toBe(1);
      const s = ours[0];
      expect(s.latestRevision?.versionLabel).toBe("1.1");
      expect(s.defaultRevisionId).toBe(revisions[0].id);
      expect(s.bindingCount).toBe(1);
      expect(s.executionCount).toBe(2);

      const detail = await getPromptDefinitionDetail(definition.id, revisions[0].id, ctx);
      expect(detail.revisions.length).toBe(2);
      expect(detail.totalBindingCount).toBe(1);
      expect(detail.totalExecutionCount).toBe(2);
      const rev0 = detail.revisions.find((r) => r.id === revisions[0].id)!;
      expect(rev0.isDefault).toBe(true);
      expect(rev0.executionCount).toBe(1);
      const rev1 = detail.revisions.find((r) => r.id === revisions[1].id)!;
      expect(rev1.isDefault).toBe(false);
      expect(rev1.bindingCount).toBe(1);
    });
  });

  it("archives a definition without defaults or bindings", async () => {
    await withTestDb(async (tx) => {
      const ctx = tx as unknown as DB;
      const [definition] = await tx
        .insert(promptDefinitions)
        .values({ kind: "corrector", name: "To archive" })
        .returning();
      await tx.insert(promptRevisions).values({
        promptDefinitionId: definition.id,
        revisionNumber: 1,
        versionLabel: "1.0",
        systemTemplate: "{{EDITORIAL_CONTEXT}}",
        userTemplate: "{{ASSEMBLY_PLAN}} {{SECCIONES_GENERADAS}}",
        requiredMarkers: ["{{EDITORIAL_CONTEXT}}", "{{ASSEMBLY_PLAN}}", "{{SECCIONES_GENERADAS}}"],
        configuration: {},
      });

      const blockers = await getArchiveBlockers(definition.id, ctx);
      expect(blockers.defaultCount).toBe(0);
      expect(blockers.bindingCount).toBe(0);

      await setPromptDefinitionArchived(definition.id, true, ctx);

      const summaries = await listPromptDefinitionSummaries(
        { kind: "corrector", archive: "archived" },
        ctx,
      );
      expect(summaries.some((s) => s.id === definition.id)).toBe(true);
    });
  });

  it("blocks archive when definition has defaults or bindings", async () => {
    await withTestDb(async (tx) => {
      const ctx = tx as unknown as DB;
      const project = await createTestProject(tx, { name: "Blocked archive" });
      const [definition] = await tx
        .insert(promptDefinitions)
        .values({ kind: "critique", name: "Blocked" })
        .returning();
      const [revision] = await tx
        .insert(promptRevisions)
        .values({
          promptDefinitionId: definition.id,
          revisionNumber: 1,
          versionLabel: "1.0",
          systemTemplate: "{{EDITORIAL_CONTEXT}}",
          userTemplate: "{{ASSEMBLY_PLAN}} {{SECCIONES_GENERADAS}}",
          requiredMarkers: ["{{EDITORIAL_CONTEXT}}", "{{ASSEMBLY_PLAN}}", "{{SECCIONES_GENERADAS}}"],
          configuration: {},
        })
        .returning();
      await tx
        .insert(promptDefaults)
        .values({ kind: "critique", promptRevisionId: revision.id })
        .onConflictDoUpdate({
          target: promptDefaults.kind,
          set: { promptRevisionId: revision.id },
        });
      await tx.insert(projectPromptBindings).values({
        projectId: project.id,
        kind: "critique",
        promptRevisionId: revision.id,
      });

      const blockers = await getArchiveBlockers(definition.id, ctx);
      expect(blockers.defaultCount).toBe(1);
      expect(blockers.bindingCount).toBe(1);

      await expect(
        setPromptDefinitionArchived(definition.id, true, ctx),
      ).rejects.toThrow("Cannot archive");
    });
  });

  it("restores an archived definition", async () => {
    await withTestDb(async (tx) => {
      const ctx = tx as unknown as DB;
      const [definition] = await tx
        .insert(promptDefinitions)
        .values({ kind: "title", name: "Restorable", archivedAt: new Date() })
        .returning();
      await tx.insert(promptRevisions).values({
        promptDefinitionId: definition.id,
        revisionNumber: 1,
        versionLabel: "1.0",
        systemTemplate: "{{EDITORIAL_CONTEXT}}",
        userTemplate: "{{ASSEMBLY_PLAN}} {{SECCIONES_GENERADAS}}",
        requiredMarkers: ["{{EDITORIAL_CONTEXT}}", "{{ASSEMBLY_PLAN}}", "{{SECCIONES_GENERADAS}}"],
        configuration: {},
      });

      await setPromptDefinitionArchived(definition.id, false, ctx);

      const summaries = await listPromptDefinitionSummaries({ kind: "title" }, ctx);
      expect(summaries.some((s) => s.id === definition.id)).toBe(true);
    });
  });
});
