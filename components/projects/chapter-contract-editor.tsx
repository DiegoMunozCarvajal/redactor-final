"use client";

import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import type { ChapterEditorialContract } from "@/lib/editorial-brief/schema";

// ---------------------------------------------------------------------------
// ChapterContractEditor
// ---------------------------------------------------------------------------

interface ChapterContractEditorProps {
  contract: ChapterEditorialContract;
  chapterTitle: string;
  onChange: (contract: ChapterEditorialContract) => void;
}

/**
 * Edits a single ChapterEditorialContract. The chapter title is display-only;
 * the chapterId is immutable.
 */
export function ChapterContractEditor({
  contract,
  chapterTitle,
  onChange,
}: ChapterContractEditorProps) {
  return (
    <div className="space-y-4 border rounded-lg p-4">
      <div className="text-sm font-semibold text-muted-foreground border-b pb-2 mb-2">
        {chapterTitle}
      </div>

      <div className="space-y-2">
        <Label htmlFor="jobToBeDone">Job to be done</Label>
        <Textarea
          id="jobToBeDone"
          className="text-sm min-h-[60px]"
          value={contract.jobToBeDone}
          onChange={(e) =>
            onChange({ ...contract, jobToBeDone: e.target.value })
          }
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="readerShift">Transformación del lector</Label>
        <Textarea
          id="readerShift"
          className="text-sm min-h-[60px]"
          value={contract.readerShift}
          onChange={(e) =>
            onChange({ ...contract, readerShift: e.target.value })
          }
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="mustCover">
          Debe cubrir (uno por línea)
        </Label>
        <textarea
          id="mustCover"
          className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm"
          value={contract.mustCover.join("\n")}
          onChange={(e) => {
            const lines = e.target.value
              .split("\n")
              .map((s) => s.trim())
              .filter(Boolean);
            onChange({ ...contract, mustCover: lines.length === 0 ? ["-"] : lines });
          }}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="requiredScenarios">
          Escenarios requeridos (uno por línea)
        </Label>
        <textarea
          id="requiredScenarios"
          className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm"
          value={contract.requiredScenarios.join("\n")}
          onChange={(e) => {
            const lines = e.target.value
              .split("\n")
              .map((s) => s.trim())
              .filter(Boolean);
            onChange({ ...contract, requiredScenarios: lines.length === 0 ? ["-"] : lines });
          }}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="toneAdjustment">
          Ajuste de tono
        </Label>
        <Textarea
          id="toneAdjustment"
          className="text-sm min-h-[60px]"
          value={contract.toneAdjustment}
          onChange={(e) =>
            onChange({ ...contract, toneAdjustment: e.target.value })
          }
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="avoidOverlapWith">
          Evitar solapamiento con (uno por línea)
        </Label>
        <textarea
          id="avoidOverlapWith"
          className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm"
          value={contract.avoidOverlapWith.join("\n")}
          onChange={(e) => {
            const lines = e.target.value
              .split("\n")
              .map((s) => s.trim())
              .filter(Boolean);
            onChange({ ...contract, avoidOverlapWith: lines.length === 0 ? ["-"] : lines });
          }}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="transitionToNext">
          Transición al siguiente
        </Label>
        <Textarea
          id="transitionToNext"
          className="text-sm min-h-[60px]"
          value={contract.transitionToNext}
          onChange={(e) =>
            onChange({ ...contract, transitionToNext: e.target.value })
          }
        />
      </div>
    </div>
  );
}
