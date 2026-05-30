"use client"

import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { Loader2, MessageSquareQuote, Trash2 } from "lucide-react"

interface CritiquePrompt {
  id: string
  title: string
  content: string
  userPrompt?: string | null
  isCritique: boolean
  position: number
}

interface CritiqueLibraryOption {
  id: string
  name: string
  description: string | null
}

interface Props {
  prompt: CritiquePrompt | null | undefined
  // Critique library picker (always shown when library available)
  critiqueLibrary?: CritiqueLibraryOption[]
  onSelectFromLibrary?: (id: string) => void
  selectingFromLibrary?: boolean
  // Execution controls
  onCritique?: () => void
  critiquing?: boolean
  onDelete?: () => void
}

export function CritiquePromptSection({
  prompt,
  critiqueLibrary,
  onSelectFromLibrary,
  selectingFromLibrary,
  onCritique,
  critiquing,
  onDelete,
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
            {critiqueLibrary && critiqueLibrary.length > 0 && onSelectFromLibrary ? (
              <div className="flex items-center justify-center gap-2">
                <select
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm max-w-[280px]"
                  onChange={(e) => {
                    if (e.target.value) onSelectFromLibrary(e.target.value)
                  }}
                  defaultValue=""
                >
                  <option value="" disabled>
                    Select a critique prompt…
                  </option>
                  {critiqueLibrary.map((cp) => (
                    <option key={cp.id} value={cp.id}>
                      {cp.name}
                    </option>
                  ))}
                </select>
                {selectingFromLibrary && (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                )}
              </div>
            ) : null}
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
              {/* Critique library dropdown — always visible */}
              {critiqueLibrary && critiqueLibrary.length > 0 && onSelectFromLibrary && (
                <div className="flex items-center gap-1.5">
                  <select
                    className="h-7 rounded-md border border-input bg-background px-2 text-[10px] max-w-[180px]"
                    value={prompt.id}
                    onChange={(e) => {
                      if (e.target.value && e.target.value !== prompt.id) {
                        onSelectFromLibrary(e.target.value)
                      }
                    }}
                  >
                    {critiqueLibrary.map((cp) => (
                      <option key={cp.id} value={cp.id}>
                        {cp.name}
                      </option>
                    ))}
                  </select>
                  {selectingFromLibrary && (
                    <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                  )}
                </div>
              )}
              {onCritique && (
                <Button size="sm" className="text-xs" onClick={onCritique} disabled={critiquing}>
                  {critiquing ? (
                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                  ) : (
                    <MessageSquareQuote className="h-3 w-3 mr-1" />
                  )}
                  {critiquing ? "Critiquing" : "Critique"}
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
