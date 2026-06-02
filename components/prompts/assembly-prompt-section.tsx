"use client"

import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { Loader2, Play, Trash2 } from "lucide-react"

interface AssemblyPrompt {
  id: string
  title: string
  content: string
  userPrompt?: string | null
  isAssembly: boolean
  position: number
}

interface AssemblyLibraryOption {
  id: string
  name: string
  description: string | null
}

interface Props {
  prompt: AssemblyPrompt | null | undefined
  // Assembly library picker (always shown when library available)
  assemblyLibrary?: AssemblyLibraryOption[]
  onSelectFromLibrary?: (id: string) => void
  selectingFromLibrary?: boolean
  // Generation controls
  onAssemble?: () => void
  assembling?: boolean
  onDelete?: () => void
}

export function AssemblyPromptSection({
  prompt,
  assemblyLibrary,
  onSelectFromLibrary,
  selectingFromLibrary,
  onAssemble,
  assembling,
  onDelete,
}: Props) {
  if (!prompt) {
    return (
      <div className="mb-8">
        <h2 className="text-sm font-medium text-muted-foreground mb-3">Assembly</h2>
        <Card className="border-dashed">
          <div className="py-8 text-center px-6">
            <p className="text-sm text-muted-foreground mb-3">
              No assembly prompt configured yet.
            </p>
            {assemblyLibrary && assemblyLibrary.length > 0 && onSelectFromLibrary ? (
              <div className="flex items-center justify-center gap-2">
                <select
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm max-w-[280px]"
                  onChange={(e) => {
                    if (e.target.value) onSelectFromLibrary(e.target.value)
                  }}
                  defaultValue=""
                >
                  <option value="" disabled>
                    Select an assembly prompt…
                  </option>
                  {assemblyLibrary.map((ap) => (
                    <option key={ap.id} value={ap.id}>
                      {ap.name}
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
      <h2 className="text-sm font-medium text-muted-foreground mb-3">Assembly</h2>
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
              {onAssemble && (
                <Button size="sm" className="text-xs" onClick={onAssemble} disabled={assembling}>
                  {assembling ? (
                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                  ) : (
                    <Play className="h-3 w-3 mr-1" />
                  )}
                  {assembling ? "Assembling" : "Assemble"}
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
