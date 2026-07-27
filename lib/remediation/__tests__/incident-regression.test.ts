import { describe, expect, it, beforeAll } from "vitest";
import { db } from "@/lib/db";
import { bookTemplates } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { auditTemplate } from "@/lib/remediation/audit";

const INCIDENT = {
  templateId: "091ea922-6293-45d6-936b-39c18b330649",
  projectId: "f67abde7-06d6-4222-bd11-ac919ecf06ed",
  chapterId: "7cd9272e-42fb-43b6-a36a-51a63d143e0a",
  placeholder: "analogia_fisica",
};

describe("incident regression", () => {
  let fixtureAvailable = false;

  beforeAll(async () => {
    try {
      const [tpl] = await db
        .select({ id: bookTemplates.id })
        .from(bookTemplates)
        .where(eq(bookTemplates.id, INCIDENT.templateId))
        .limit(1);
      fixtureAvailable = !!tpl;
    } catch {
      fixtureAvailable = false;
    }
  });

  it("classifies confirmed incident template as contaminated", async () => {
    // Fixture-dependent — requires the original incident rows in the DB.
    // These tests exist to catch regressions against the specific confirmed
    // contamination incident (project f67abde7, chapter 7cd9272e).
    // Skip when fixture is absent (e.g., local dev without production data).
    if (!fixtureAvailable) {
      console.warn("[incident-regression] Skipping: fixture data not available in this environment");
      return;
    }

    const report = await auditTemplate(INCIDENT.templateId);
    expect(report.templateId).toBe(INCIDENT.templateId);
    expect(report.classification).toBe("contaminated");
    expect(report.derivedProjectIds).toContain(INCIDENT.projectId);
  });

  it("never leaks snippets, labels, or regex patterns", async () => {
    if (!fixtureAvailable) {
      console.warn("[incident-regression] Skipping: fixture data not available in this environment");
      return;
    }

    const report = await auditTemplate(INCIDENT.templateId);
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain("snippet");
    expect(serialized).not.toContain("canonicalLabel");
    expect(serialized).not.toContain("\\b");
  });
});
