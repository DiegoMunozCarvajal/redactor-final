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
import { Pencil, Save, History, Play } from "lucide-react"
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
  isAssembly: boolean
  position: number
}

interface Props {
  prompt: AssemblyPrompt | null | undefined
  onSave: (data: { title: string; content: string }) => Promise<void>
  versionsApiUrl: string
  readOnly?: boolean
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
}

export function AssemblyPromptSection({
  prompt, onSave, versionsApiUrl, readOnly,
  models, assemblyModel, onAssemblyModelChange,
  assemblyEffort, onAssemblyEffortChange,
  assemblyTemperature, onAssemblyTemperatureChange,
  onAssemble, assembling,
}: Props) {
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(prompt?.title ?? "")
  const [content, setContent] = useState(prompt?.content ?? "")
  const [saving, setSaving] = useState(false)
  const [showVersions, setShowVersions] = useState(false)

  if (!prompt) {
    return (
      <div className="mb-8">
        <h2 className="text-sm font-medium text-muted-foreground mb-3">Assembly</h2>
        <Card className="border-dashed">
          <CardContent className="py-8 text-center">
            <p className="text-sm text-muted-foreground">No assembly prompt configured yet.</p>
            {!readOnly && (
              <Button variant="outline" size="sm" className="mt-2" onClick={() => setEditing(true)}>
                Create Assembly Prompt
              </Button>
            )}
          </CardContent>
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
                {editing ? (
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="bg-transparent border-0 border-b border-border focus:outline-none focus:border-primary text-sm font-medium"
                    placeholder="Assembly prompt title"
                  />
                ) : (
                  prompt.title
                )}
              </CardTitle>
            </div>
            <div className="flex items-center gap-2">
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
              {!readOnly && (
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  onClick={() => {
                    if (editing) {
                      setSaving(true)
                      onSave({ title, content }).finally(() => setSaving(false))
                      setEditing(false)
                    } else {
                      setTitle(prompt.title)
                      setContent(prompt.content)
                      setEditing(true)
                    }
                  }}
                  disabled={saving}
                >
                  {editing ? <Save className="h-3 w-3" /> : <Pencil className="h-3 w-3 text-muted-foreground" />}
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
          <CardContent className="border-t pt-3">
            <div className="space-y-1.5">
              <Label className="text-[10px] text-muted-foreground">Content</Label>
              <Textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                className="text-xs min-h-[100px]"
                placeholder="Assembly prompt content..."
              />
            </div>
          </CardContent>
        )}
      </Card>
    </div>
  )
}
