"use client";

import { useState, useEffect } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { X, Plus } from "lucide-react";
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

      <ArrayTextareaField
        label="Debe cubrir (uno por línea)"
        id="mustCover"
        value={contract.mustCover}
        onChange={(v) => onChange({ ...contract, mustCover: v })}
      />

      <ArrayTextareaField
        label="Escenarios requeridos (uno por línea)"
        id="requiredScenarios"
        value={contract.requiredScenarios}
        onChange={(v) => onChange({ ...contract, requiredScenarios: v })}
      />

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

      <ArrayTextareaField
        label="Evitar solapamiento con (uno por línea)"
        id="avoidOverlapWith"
        value={contract.avoidOverlapWith}
        onChange={(v) => onChange({ ...contract, avoidOverlapWith: v })}
      />

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

      {/* Evidence needs */}
      <div className="space-y-2">
        <Label>Necesidades de evidencia</Label>
        {contract.evidenceNeeds.map((need, i) => (
          <div key={i} className="flex gap-2 items-start border rounded-md p-2">
            <div className="flex-1 space-y-1">
              <Input
                className="text-xs h-7"
                placeholder="Nombre del placeholder (ej. estadisticas_primer_mensaje)"
                value={need.placeholderName}
                onChange={(e) => {
                  const updated = [...contract.evidenceNeeds];
                  updated[i] = { ...need, placeholderName: e.target.value };
                  onChange({ ...contract, evidenceNeeds: updated });
                }}
              />
              <Input
                className="text-xs h-7"
                placeholder="Query de búsqueda (ej. response rates by message type)"
                value={need.query}
                onChange={(e) => {
                  const updated = [...contract.evidenceNeeds];
                  updated[i] = { ...need, query: e.target.value };
                  onChange({ ...contract, evidenceNeeds: updated });
                }}
              />
            </div>
            <label className="flex items-center gap-1 text-xs pt-1">
              <input
                type="checkbox"
                checked={need.required}
                onChange={(e) => {
                  const updated = [...contract.evidenceNeeds];
                  updated[i] = { ...need, required: e.target.checked };
                  onChange({ ...contract, evidenceNeeds: updated });
                }}
              />
              Requerido
            </label>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              onClick={() => {
                const updated = contract.evidenceNeeds.filter((_, j) => j !== i);
                onChange({ ...contract, evidenceNeeds: updated });
              }}
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        ))}
        <Button
          variant="outline"
          size="sm"
          className="text-xs"
          onClick={() => {
            onChange({
              ...contract,
              evidenceNeeds: [
                ...contract.evidenceNeeds,
                { placeholderName: "", query: "", required: false },
              ],
            });
          }}
        >
          <Plus className="h-3 w-3 mr-1" /> Agregar necesidad de evidencia
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Array textarea helper (normalizes on blur)
// ---------------------------------------------------------------------------

function ArrayTextareaField({
  label,
  id,
  value,
  onChange,
}: {
  label: string;
  id: string;
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const [raw, setRaw] = useState(value.join("\n"));
  const joined = value.join("\n");

  useEffect(() => {
    setRaw(joined);
  }, [joined]);

  const handleBlur = () => {
    const lines = raw
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    onChange(lines.length === 0 ? ["-"] : lines);
  };

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <textarea
        id={id}
        className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm"
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        onBlur={handleBlur}
      />
    </div>
  );
}
