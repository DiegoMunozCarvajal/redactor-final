"use client"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Loader2, Wrench } from "lucide-react"
import { AVAILABLE_MODELS, DEFAULT_GENERATION_MODEL } from "@/lib/ai/providers"
import type { ModelDefinition } from "@/lib/ai/providers"
import type { EffectiveReviewPrompt, ReviewPromptRevision } from "@/components/prompts/review-prompt-registry"

const MODEL_OPTIONS = AVAILABLE_MODELS.map((m: ModelDefinition) => ({ id: m.id, label: m.label }))

interface Props {
  prompt: EffectiveReviewPrompt | null;
  revisions: ReviewPromptRevision[];
  bindingRevisionId: string | null;
  defaultRevisionId: string | null;
  loading: boolean;
  error: string | null;
  saving: boolean;
  onRetry: () => void;
  onRevisionChange: (value: string) => void;
  onCorrect?: () => void;
  correcting?: boolean;
  model?: string;
  onModelChange?: (model: string) => void;
  blocked?: boolean;
  blockedReason?: string;
}

export function CorrectorPromptSection({
  prompt,
  revisions,
  bindingRevisionId,
  defaultRevisionId,
  loading,
  error,
  saving,
  onRetry,
  onRevisionChange,
  onCorrect,
  correcting,
  model = DEFAULT_GENERATION_MODEL,
  onModelChange,
  blocked = false,
  blockedReason,
}: Props) {
  const defaultPrompt = defaultRevisionId
    ? revisions.find((r) => r.id === defaultRevisionId) ?? null
    : null;

  if (loading) {
    return (
      <div className="mb-8">
        <h2 className="text-sm font-medium text-muted-foreground mb-3">Corrector</h2>
        <Card className="border-dashed">
          <div className="py-8 text-center px-6">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">Loading corrector prompt registry...</p>
          </div>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mb-8">
        <h2 className="text-sm font-medium text-muted-foreground mb-3">Corrector</h2>
        <Card className="border-destructive/30">
          <div className="py-8 text-center px-6">
            <p className="text-sm text-destructive mb-3">{error}</p>
            <Button size="sm" variant="outline" onClick={onRetry}>Retry</Button>
          </div>
        </Card>
      </div>
    );
  }

  if (!prompt) {
    return (
      <div className="mb-8">
        <h2 className="text-sm font-medium text-muted-foreground mb-3">Corrector</h2>
        <Card className="border-dashed">
          <div className="py-8 text-center px-6">
            <p className="text-sm text-muted-foreground mb-3">
              No effective revision configured.
            </p>
          </div>
        </Card>
      </div>
    );
  }

  const selectorValue = bindingRevisionId ?? "__global_default__";
  const isDisabled = loading || saving;

  return (
    <div className="mb-8">
      <h2 className="text-sm font-medium text-muted-foreground mb-3">Corrector</h2>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CardTitle className="text-sm">
                {prompt.name} v{prompt.versionLabel}
              </CardTitle>
              <Badge variant="secondary" className="text-[10px]">
                {prompt.source === "project-binding" ? "Project binding" : "Global default"}
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              <Select
                value={selectorValue}
                onValueChange={onRevisionChange}
                disabled={isDisabled}
              >
                <SelectTrigger className="w-[220px] h-7 text-[10px]" aria-label="Corrector prompt revision">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__global_default__" className="text-[10px]">
                    Use global default
                    {defaultPrompt ? ` — ${defaultPrompt.name} v${defaultPrompt.versionLabel}` : " — not configured"}
                  </SelectItem>
                  {revisions.map((r) => (
                    <SelectItem key={r.id} value={r.id} className="text-[10px]">
                      {r.name} v{r.versionLabel}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {onModelChange && (
                <Select value={model} onValueChange={onModelChange} disabled={isDisabled}>
                  <SelectTrigger className="w-[140px] h-7 text-[10px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MODEL_OPTIONS.map((m) => (
                      <SelectItem key={m.id} value={m.id} className="text-[10px]">
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {onCorrect && (
                <Button
                  size="sm"
                  className="text-xs"
                  onClick={onCorrect}
                  disabled={correcting || blocked || isDisabled}
                  title={blocked ? (blockedReason ?? "Correction not available") : undefined}
                >
                  {correcting ? (
                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                  ) : (
                    <Wrench className="h-3 w-3 mr-1" />
                  )}
                  {correcting ? "Correcting" : blocked ? "Corrected" : "Corregir"}
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
      </Card>
    </div>
  );
}
