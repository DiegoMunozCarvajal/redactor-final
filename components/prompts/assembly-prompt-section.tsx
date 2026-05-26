"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Loader2, Save, History, Play, Trash2 } from "lucide-react"
import { VersionHistory } from "@/components/prompts/version-history"

interface ModelOption {
  id: string
  label: string
  short: string
}

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
  onSave: (data: { title: string; content: string; userPrompt?: string | null }) => Promise<void>
  versionsApiUrl: string
  readOnly?: boolean
  // Assembly library picker (when no embedded prompt)
  assemblyLibrary?: AssemblyLibraryOption[]
  onSelectFromLibrary?: (id: string) => void
  selectingFromLibrary?: boolean
  // Generation controls
  models?: ModelOption[]
  assemblyModel?: string
  onAssemblyModelChange?: (v: string) => void
  assemblyEffort?: string
  onAssemblyEffortChange?: (v: string) => void
  assemblyTemperature?: number
  onAssemblyTemperatureChange?: (v: number) => void
  onAssemble?: () => void
  assembling?: boolean
  onDelete?: () => void
}

export function AssemblyPromptSection({
  prompt, onSave, versionsApiUrl, readOnly,
  assemblyLibrary, onSelectFromLibrary, selectingFromLibrary,
  models, assemblyModel, onAssemblyModelChange,
  assemblyEffort, onAssemblyEffortChange,
  assemblyTemperature, onAssemblyTemperatureChange,
  onAssemble, assembling, onDelete,
}: Props) {
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(prompt?.title ?? "")
  const [content, setContent] = useState(prompt?.content ?? "")
  const [userPrompt, setUserPrompt] = useState(prompt?.userPrompt ?? "")
  const [saving, setSaving] = useState(false)
  const [showVersions, setShowVersions] = useState(false)

  if (!prompt) {
    return (
      <div className="mb-8">
        <h2 className="text-sm font-medium text-muted-foreground mb-3">Assembly</h2>
        <Card className="border-dashed">
          <CardContent className="py-8 text-center">
            <p className="text-sm text-muted-foreground mb-3">
              No assembly prompt configured yet.
            </p>
            {!readOnly && assemblyLibrary && assemblyLibrary.length > 0 && onSelectFromLibrary ? (
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
            ) : !readOnly ? (
              <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                Create Assembly Prompt
              </Button>
            ) : null}
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="mb-8">
      <h2 className="text-sm font-medium text-muted-foreground mb-3">Assembly</h2>
      <Card
        className="cursor-pointer hover:border-primary/30 transition-colors"
        onClick={() => {
          if (!editing && !readOnly) {
            setTitle(prompt.title);
            setContent(prompt.content);
            setUserPrompt(prompt.userPrompt ?? "");
            setEditing(true);
          }
        }}
      >
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground font-mono">
                {prompt.position + 1}.
              </span>
              <CardTitle className="text-sm">
                {editing ? (
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="bg-transparent border-0 border-b border-border focus:outline-none focus:border-primary text-sm font-medium"
                    placeholder="Assembly prompt title"
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  prompt.title
                )}
              </CardTitle>
            </div>
            <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
              {/* Assembly controls */}
              {models && onAssemble && (
                <>
                  <Select value={assemblyModel ?? ""} onValueChange={(v) => onAssemblyModelChange?.(v)}>
                    <SelectTrigger className="w-[100px] h-7 text-[10px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {models.map((m) => (
                        <SelectItem key={m.id} value={m.id} className="text-[10px]">{m.short}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={assemblyEffort ?? "max"} onValueChange={(v) => onAssemblyEffortChange?.(v)}>
                    <SelectTrigger className="w-[55px] h-7 text-[10px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="max" className="text-[10px]">Max</SelectItem>
                      <SelectItem value="off" className="text-[10px]">Alto</SelectItem>
                    </SelectContent>
                  </Select>
                  {assemblyEffort === "off" && (
                    <Input
                      type="number"
                      min={0}
                      max={1}
                      step={0.1}
                      value={assemblyTemperature ?? 0.7}
                      onChange={(e) => {
                        const v = parseFloat(e.target.value);
                        onAssemblyTemperatureChange?.(isNaN(v) ? 0.7 : v);
                      }}
                      className="w-[48px] h-7 text-[10px] px-1"
                    />
                  )}
                  <Button size="sm" className="text-xs" onClick={onAssemble} disabled={assembling}>
                    <Play className="h-3 w-3 mr-1" /> Assemble
                  </Button>
                </>
              )}
              {prompt.id && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-xs"
                  onClick={() => setShowVersions(!showVersions)}
                >
                  <History className="h-3 w-3 mr-1" /> Versions
                </Button>
              )}
              {!readOnly && onDelete && (
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

        {showVersions && prompt.id && (
          <CardContent className="border-t pt-3">
            <VersionHistory versionsApiUrl={versionsApiUrl} promptId={prompt.id} />
          </CardContent>
        )}

        {editing && (
          <CardContent className="border-t pt-3" onClick={(e) => e.stopPropagation()}>
            <div className="space-y-1.5">
              <Label className="text-[10px] text-muted-foreground">Content (System Prompt)</Label>
              <Textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                className="text-xs min-h-[100px]"
                placeholder="System prompt for assembly..."
              />
            </div>
            <div className="space-y-1.5 mt-3">
              <Label className="text-[10px] text-muted-foreground">User Prompt</Label>
              <Textarea
                value={userPrompt}
                onChange={(e) => setUserPrompt(e.target.value)}
                className="text-xs min-h-[100px]"
                placeholder="User message. Use {name} for placeholders. Use [PEGAR AQUÍ TODOS LOS FRAGMENTOS DEL CAPÍTULO] marker. Leave empty to use Content as user message with default system prompt."
              />
            </div>
            <div className="flex justify-end gap-2 mt-3">
              <Button
                size="sm"
                variant="outline"
                className="text-xs"
                onClick={(e) => {
                  e.stopPropagation();
                  setEditing(false);
                }}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                className="text-xs"
                disabled={saving}
                onClick={async (e) => {
                  e.stopPropagation();
                  setSaving(true);
                  try {
                    await onSave({ title, content, userPrompt: userPrompt || null });
                  } finally {
                    setSaving(false);
                  }
                  setEditing(false);
                }}
              >
                {saving ? "Saving..." : "Save"}
              </Button>
            </div>
          </CardContent>
        )}
      </Card>
    </div>
  )
}
