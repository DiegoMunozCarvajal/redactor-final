"use client";

import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Wrench, ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";
import type { ModelDefinition } from "@/lib/ai/providers";
import { AVAILABLE_MODELS, DEFAULT_GENERATION_MODEL } from "@/lib/ai/providers";

// Flat { id, label } list for model selector dropdown
const MODEL_OPTIONS = AVAILABLE_MODELS.map((m: ModelDefinition) => ({ id: m.id, label: m.label }));
const DEFAULT_MODEL = DEFAULT_GENERATION_MODEL;

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
  /** Pre-select this corrector prompt from the project (hides library picker) */
  projectCorrectorPromptId?: string;
  /** Content for the project-level corrector prompt (used when passing inline to API) */
  projectCorrectorPromptContent?: string;
  /** User prompt for the project-level corrector prompt */
  projectCorrectorPromptUserPrompt?: string | null;
  modalOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CorrectorSection({ projectId, chapterId, generations, hasAssembly, onGenerationCreated, projectCorrectorPromptId, projectCorrectorPromptContent, projectCorrectorPromptUserPrompt, modalOpen, onOpenChange }: Props) {
  const [correctorPromptId, setCorrectorPromptId] = useState(projectCorrectorPromptId ?? "");
  const [correctorPromptList, setCorrectorPromptList] = useState<{ id: string; name: string; description: string | null }[]>([]);
  const [correcting, setCorrecting] = useState(false);
  const [correctorModel, setCorrectorModel] = useState(DEFAULT_MODEL);

  // Sync project-level corrector prompt ID when it changes
  useEffect(() => {
    if (projectCorrectorPromptId) {
      setCorrectorPromptId(projectCorrectorPromptId);
    }
  }, [projectCorrectorPromptId]);

  // Critique generations (needed to select which critique to apply)
  const critiqueGenerations = generations.filter(
    (g) => g.generationMetadata?.type === "critique" && g.status === "completed" && g.assembledContent,
  );
  const [selectedCritiqueGenId, setSelectedCritiqueGenId] = useState("");

  // Fetch corrector prompts and pre-select critique when modal opens
  useEffect(() => {
    if (!modalOpen) return;
    if (correctorPromptList.length === 0) {
      fetch("/api/prompt-library?category=corrector")
        .then((r) => r.json())
        .then((data) => {
          if (Array.isArray(data)) setCorrectorPromptList(data);
        })
        .catch(() => {});
    }
    if (critiqueGenerations.length > 0 && !selectedCritiqueGenId) {
      setSelectedCritiqueGenId(critiqueGenerations[0].id);
    }
  }, [modalOpen]);  // eslint-disable-line react-hooks/exhaustive-deps

  async function runCorrection() {
    if (!projectCorrectorPromptId && !correctorPromptId) {
      toast.error("Select a corrector prompt");
      return;
    }
    if (!selectedCritiqueGenId) {
      toast.error("Select a critique to apply");
      return;
    }
    setCorrecting(true);
    try {
      // Use inline prompt when project prompt is available, otherwise use library ID
      const body: Record<string, unknown> = {
        critiqueGenerationId: selectedCritiqueGenId,
        model: correctorModel,
      };
      if (projectCorrectorPromptId && projectCorrectorPromptContent) {
        body.correctorPrompt = {
          content: projectCorrectorPromptContent,
          userPrompt: projectCorrectorPromptUserPrompt ?? null,
        };
      } else {
        body.correctorPromptId = correctorPromptId;
      }
      const res = await fetch(
        `/api/projects/${projectId}/chapters/${chapterId}/correct`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (res.ok) {
        onOpenChange(false);
        onGenerationCreated();
        toast.success("Correction completed");
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error ?? "Correction error");
      }
    } catch {
      toast.error("Network error");
    } finally {
      setCorrecting(false);
    }
  }

  return (
    <>
      {/* Corrector Modal */}
      <Dialog open={modalOpen} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Correct Chapter</DialogTitle>
            <DialogDescription>
              {correcting
                ? "Correction is running in the background."
                : "Select a corrector prompt and a critique to apply fixes to the chapter."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {correcting && (
              <div className="rounded-md border border-info/30 bg-info/5 p-3" role="status" aria-live="polite">
                <div className="flex items-start gap-2">
                  <Loader2 className="h-4 w-4 animate-spin text-info mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-info">Running correction</p>
                    <p className="text-xs text-muted-foreground">
                      Keep this open or close it; polling will refresh results automatically.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {!hasAssembly && (
              <div className="rounded-md border border-warning/30 bg-warning/5 p-3">
                <p className="text-xs text-warning">
                  No assembled content found. Assemble the chapter first before running a correction.
                </p>
              </div>
            )}

            {critiqueGenerations.length === 0 && hasAssembly && (
              <div className="rounded-md border border-warning/30 bg-warning/5 p-3">
                <p className="text-xs text-warning">
                  No critique found. Run a critique first before correcting.
                </p>
              </div>
            )}

            {/* Critique selection */}
            {critiqueGenerations.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-medium">Critique to Apply</h4>
                <Select
                  value={selectedCritiqueGenId}
                  onValueChange={(v) => setSelectedCritiqueGenId(v)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select a critique…" />
                  </SelectTrigger>
                  <SelectContent>
                    {critiqueGenerations.map((g) => (
                      <SelectItem key={g.id} value={g.id}>
                        {g.generationMetadata?.promptTitle ?? "Critique"} — {g.completedAt ? new Date(g.completedAt).toLocaleString() : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Corrector prompt picker */}
            {projectCorrectorPromptId ? (
              <div className="rounded-md bg-muted/40 p-3 text-xs">
                <span className="text-muted-foreground">Using project corrector prompt</span>
              </div>
            ) : (
              <div className="space-y-2">
                <h4 className="text-sm font-medium flex items-center gap-1.5">
                  <Wrench className="h-3.5 w-3.5 text-muted-foreground" />
                  Corrector Prompt
                </h4>
                {correctorPromptList.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No corrector prompts available. Create one in the Correctores section.</p>
                ) : (
                  <Select
                    value={correctorPromptId}
                    onValueChange={(v) => setCorrectorPromptId(v)}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select a corrector prompt…" />
                    </SelectTrigger>
                    <SelectContent>
                      {correctorPromptList.map((cp) => (
                        <SelectItem key={cp.id} value={cp.id}>{cp.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between pt-4 border-t">
            <Select value={correctorModel} onValueChange={setCorrectorModel}>
              <SelectTrigger className="w-[170px] h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MODEL_OPTIONS.map((m) => (
                  <SelectItem key={m.id} value={m.id} className="text-xs">
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              onClick={runCorrection}
              disabled={correcting || !correctorPromptId || !selectedCritiqueGenId || !hasAssembly}
            >
              {correcting ? (
                <Loader2 className="h-3 w-3 animate-spin mr-1" />
              ) : (
                <Wrench className="h-3 w-3 mr-1" />
              )}
              {correcting ? "Correcting" : "Run Correction"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
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
