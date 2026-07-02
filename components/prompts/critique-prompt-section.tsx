"use client"

import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Loader2, MessageSquareQuote, Trash2 } from "lucide-react"
import { AVAILABLE_MODELS, DEFAULT_GENERATION_MODEL } from "@/lib/ai/providers"
import type { ModelDefinition } from "@/lib/ai/providers"

const MODEL_OPTIONS = AVAILABLE_MODELS.map((m: ModelDefinition) => ({ id: m.id, label: m.label }))

interface CritiquePrompt {
  id: string
  title: string
  content: string
  userPrompt?: string | null
  isCritique: boolean
  position: number
}

interface Props {
  prompt: CritiquePrompt | null | undefined
  onCritique?: () => void
  critiquing?: boolean
  onDelete?: () => void
  model?: string
  onModelChange?: (model: string) => void
  blocked?: boolean
  blockedReason?: string
}

export function CritiquePromptSection({
  prompt,
  onCritique,
  critiquing,
  onDelete,
  model = DEFAULT_GENERATION_MODEL,
  onModelChange,
  blocked = false,
  blockedReason,
}: Props) {
  if (!prompt) {
    return (
      <div className="mb-8">
        <h2 className="text-sm font-medium text-muted-foreground mb-3">Critique</h2>
        <Card className="border-dashed">
          <div className="py-8 text-center px-6">
            <p className="text-sm text-muted-foreground mb-3">
              No critique prompt configured yet.
            </p>
          </div>
        </Card>
      </div>
    )
  }

  return (
    <div className="mb-8">
      <h2 className="text-sm font-medium text-muted-foreground mb-3">Critique</h2>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground font-mono">
                {prompt.position + 1}.
              </span>
              <CardTitle className="text-sm">
                {prompt.title}
              </CardTitle>
            </div>
            <div className="flex items-center gap-2">
              {onModelChange && (
                <Select value={model} onValueChange={onModelChange}>
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
              {onCritique && (
                <Button
                  size="sm"
                  className="text-xs"
                  onClick={onCritique}
                  disabled={critiquing || blocked}
                  title={blocked ? (blockedReason ?? "Already critiqued with this prompt") : undefined}
                >
                  {critiquing ? (
                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                  ) : (
                    <MessageSquareQuote className="h-3 w-3 mr-1" />
                  )}
                  {critiquing ? "Critiquing" : blocked ? "Critiqued" : "Critique"}
                </Button>
              )}
              {onDelete && (
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                  onClick={onDelete}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
      </Card>
    </div>
  )
}
