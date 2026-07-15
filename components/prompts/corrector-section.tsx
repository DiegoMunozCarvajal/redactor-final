"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { toast } from "sonner";
import { ChevronDown, ChevronUp } from "lucide-react";
import { buildCorrectionRequestBody } from "@/lib/review/request-payloads";

interface Generation {
  id: string;
  status: string;
  assembledContent: string | null;
  completedAt: string | null;
  generationMetadata?: {
    type?: string;
    promptId?: string;
    promptTitle?: string;
    model?: string;
    critiqueGenerationId?: string;
  } | null;
  assemblyMetadata?: {
    algorithm?: string;
    promptId?: string;
    promptTitle?: string;
    promptSource?: string;
    model?: string;
    fragmentCount?: number;
    critiqueGenerationId?: string;
    correctionRaw?: string;
  } | null;
}

interface Props {
  projectId: string;
  chapterId: string;
  generations: Generation[];
  hasAssembly: boolean;
  onGenerationCreated: () => void;
  correctorPromptRevisionId?: string;
  correctionTrigger: number;
  correctorModel: string;
  onCorrectingChange: (correcting: boolean) => void;
  selectedCritiqueGenerationId?: string;
}

export function CorrectorSection({ projectId, chapterId, generations, hasAssembly, onGenerationCreated, correctorPromptRevisionId, correctionTrigger, correctorModel, onCorrectingChange, selectedCritiqueGenerationId }: Props) {
  const prevTrigger = useRef(correctionTrigger);

  // Critique generations (needed to select which critique to apply)
  const critiqueGenerations = generations.filter(
    (g) => g.generationMetadata?.type === "critique" && g.status === "completed" && g.assembledContent,
  );

  useEffect(() => {
    if (correctionTrigger === 0 || correctionTrigger === prevTrigger.current) return;
    prevTrigger.current = correctionTrigger;

    if (!correctorPromptRevisionId) {
      toast.error("No corrector prompt configured");
      return;
    }
    if (!hasAssembly) {
      toast.error("Assemble the chapter first before running a correction");
      return;
    }
    if (critiqueGenerations.length === 0) {
      toast.error("Run a critique first before correcting");
      return;
    }

    const selectedCritiqueGenId = selectedCritiqueGenerationId ?? critiqueGenerations[0]?.id;
    if (!selectedCritiqueGenId) {
      toast.error("No critique available for correction");
      return;
    }

    onCorrectingChange(true);

    (async () => {
      try {
        const body = buildCorrectionRequestBody(
          correctorPromptRevisionId,
          selectedCritiqueGenId,
          correctorModel,
        );
        const res = await fetch(
          `/api/projects/${projectId}/chapters/${chapterId}/correct`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          },
        );
        if (res.ok) {
          onGenerationCreated();
          toast.success("Correction started");
        } else {
          const err = await res.json().catch(() => ({}));
          toast.error(err.error ?? "Correction error");
        }
      } catch {
        toast.error("Network error");
      } finally {
        onCorrectingChange(false);
      }
    })();
  }, [correctionTrigger]);  // eslint-disable-line react-hooks/exhaustive-deps

  // Still render nothing visible — this is a logic-only component now.
  // The UI (model selector + button) lives in CorrectorPromptSection.
  return null;
}

/** Extracts <correcciones> from the raw output and renders a collapsible diff */
export function CorrectionDiff({ raw }: { raw: string }) {
  const [open, setOpen] = useState(false);

  const corrections = useMemo(() => {
    const match = raw.match(/<correcciones>([\s\S]*?)<\/correcciones>/);
    if (!match) return null;
    return match[1].trim();
  }, [raw]);

  if (!corrections) return null;

  // Parse individual <correccion> and <omitida> blocks
  const blocks = corrections.match(/<(correccion|omitida)>[\s\S]*?<\/\1>/g) ?? [];

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        Corrections ({blocks.length} change{blocks.length !== 1 ? "s" : ""})
      </button>
      {open && (
        <div className="mt-2 space-y-3 text-xs">
          {blocks.map((block, i) => {
            const tipo = block.match(/<(correccion|omitida)>/)?.[1] ?? "correccion";
            const ubicacion = block.match(/<ubicacion>([\s\S]*?)<\/ubicacion>/)?.[1]?.trim();
            const hallazgo = block.match(/<hallazgo>([\s\S]*?)<\/hallazgo>/)?.[1]?.trim();
            const antes = block.match(/<antes>([\s\S]*?)<\/antes>/)?.[1]?.trim();
            const despues = block.match(/<despues>([\s\S]*?)<\/despues>/)?.[1]?.trim();
            const motivo = block.match(/<motivo>([\s\S]*?)<\/motivo>/)?.[1]?.trim();

            return (
              <div key={i} className="rounded-md border p-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-muted-foreground">{ubicacion}</span>
                  {hallazgo && (
                    <span className="bg-muted px-1.5 py-0.5 rounded text-[10px]">{hallazgo}</span>
                  )}
                  {tipo === "omitida" && (
                    <span className="bg-warning/10 text-warning px-1.5 py-0.5 rounded text-[10px]">Skipped</span>
                  )}
                </div>
                {motivo && (
                  <p className="text-muted-foreground mb-2">{motivo}</p>
                )}
                {antes && despues && (
                  <div className="grid grid-cols-1 gap-2">
                    <div>
                      <span className="text-[10px] text-destructive font-medium">Before</span>
                      <pre className="mt-1 whitespace-pre-wrap text-destructive/80 bg-destructive/5 p-2 rounded text-[11px] leading-relaxed">{antes}</pre>
                    </div>
                    <div>
                      <span className="text-[10px] text-success font-medium">After</span>
                      <pre className="mt-1 whitespace-pre-wrap text-success/80 bg-success/5 p-2 rounded text-[11px] leading-relaxed">{despues}</pre>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
