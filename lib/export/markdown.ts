import { getRunWithUnits } from "@/lib/db/queries/runs";

import { renderSmallBookMarkdown } from "./markdown-small-book";

export async function renderRunMarkdown(runId: string): Promise<string> {
  const run = await getRunWithUnits(runId);
  if (!run) {
    throw new Error(`Run not found: ${runId}`);
  }

  if (run.productMode !== "small_book") {
    throw new Error("Workbook export not implemented — Phase 3.");
  }

  const chapterUnits = run.units.filter(
    (unit) => unit.unitType === "chapter" && unit.parentUnitId == null,
  );

  if (chapterUnits.length === 0) {
    throw new Error(`Run ${runId} has no completed chapters yet.`);
  }

  return renderSmallBookMarkdown({
    bookTitle: run.title || run.subtitle || "Book",
    units: chapterUnits.map((unit) => {
      const brief = unit.brief as { chapterTitle?: string } | null;
      return {
        sortOrder: unit.sortOrder,
        workingTitle: brief?.chapterTitle ?? `Chapter ${unit.sortOrder}`,
        revisedMarkdown: (unit.revised as { markdown?: string } | null)?.markdown,
        draftMarkdown: (unit.draft as { markdown?: string } | null)?.markdown,
      };
    }),
  });
}

export async function exportToMarkdown(runId: string): Promise<string> {
  return renderRunMarkdown(runId);
}
