"use client"

import { useEffect, useState } from "react"
import { useParams } from "next/navigation"
import { Breadcrumbs } from "@/components/ui/breadcrumbs"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { VersionHistory } from "@/components/prompts/version-history"
import { Loader2, Plus, Save, Check, X, Trash2 } from "lucide-react"
import { toast } from "sonner"
import type { ChapterPlaceholder, Prompt } from "@/lib/db/schema"

export default function ChapterPromptEditorPage() {
  const params = useParams<{ id: string; chapterId: string }>()
  const [prompts, setPrompts] = useState<Prompt[]>([])
  const [chapterTitle, setChapterTitle] = useState("")
  const [bookName, setBookName] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [addingPrompt, setAddingPrompt] = useState(false)
  const [addingAssembly, setAddingAssembly] = useState(false)
  const [newPrompt, setNewPrompt] = useState({ title: "", content: "" })
  const [promptFormData, setPromptFormData] = useState<Record<string, { title: string; content: string }>>({})
  const [saving, setSaving] = useState<Record<string, boolean>>({})
  const [showVersions, setShowVersions] = useState<Record<string, boolean>>({})
  const [placeholders, setPlaceholders] = useState<ChapterPlaceholder[]>([])
  const [configFormData, setConfigFormData] = useState<Record<string, string>>({})
  const [savingConfig, setSavingConfig] = useState(false)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      fetch(`/api/chapters/${params.chapterId}/prompts`)
        .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
        .then((data) => { if (!cancelled) setPrompts(data) }),
      fetch(`/api/chapters/${params.chapterId}`)
        .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
        .then((ch) => { if (!cancelled) setChapterTitle(ch.title ?? "") }),
      fetch(`/api/books/${params.id}`)
        .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
        .then((b) => { if (!cancelled) setBookName(b.name ?? "") }),
      fetch(`/api/chapters/${params.chapterId}/placeholders`)
        .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
        .then((data) => { if (!cancelled) setPlaceholders(data) }),
      fetch(`/api/chapters/${params.chapterId}/config-prompts`)
        .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
        .then((data) => { if (!cancelled) {
          const form: Record<string, string> = {};
          for (const cp of data) form[cp.type] = cp.content;
          setConfigFormData(form);
        }})
        .catch(() => {}), // non-critical
    ])
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load") })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [params.chapterId, params.id])

  useEffect(() => {
    setPromptFormData((prev) => {
      const next = { ...prev }
      for (const p of prompts) {
        if (!next[p.id]) {
          next[p.id] = { title: p.title, content: p.content }
        }
      }
      return next
    })
  }, [prompts])

  function getFormData(promptId: string, prompt: Prompt) {
    return {
      title: promptFormData[promptId]?.title ?? prompt.title,
      content: promptFormData[promptId]?.content ?? prompt.content,
    }
  }

  async function savePrompt(promptId: string) {
    const prompt = prompts.find((p) => p.id === promptId)
    if (!prompt) return
    const data = promptFormData[promptId]
    if (!data) return

    setSaving((s) => ({ ...s, [promptId]: true }))
    try {
      const res = await fetch(`/api/prompts/${promptId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: data.title,
          content: data.content,
          isAssembly: prompt.isAssembly,
        }),
      })
      if (res.ok) {
        const updated = await res.json()
        setPrompts((prev) => prev.map((p) => (p.id === promptId ? updated : p)))
        fetchPlaceholders()
        toast.success("Prompt saved")
      } else {
        const err = await res.json().catch(() => ({}))
        toast.error(err.error ?? "Error saving")
      }
    } catch {
      toast.error("Network error")
    } finally {
      setSaving((s) => ({ ...s, [promptId]: false }))
    }
  }

  async function createPrompt(isAssembly: boolean) {
    const { title, content } = newPrompt
    if (!title || !content) {
      toast.error("Title and content are required")
      return
    }
    const res = await fetch(`/api/chapters/${params.chapterId}/prompts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        content,
        position: prompts.length,
        isAssembly,
      }),
    })
    if (res.ok) {
      const p = await res.json()
      setPrompts([...prompts, p])
      setAddingPrompt(false)
      setAddingAssembly(false)
      setNewPrompt({ title: "", content: "" })
      fetchPlaceholders()
      toast.success("Prompt added")
    } else {
      const err = await res.json().catch(() => ({}))
      toast.error(err.error ?? "Error adding prompt")
    }
  }

  async function fetchPlaceholders() {
    try {
      const res = await fetch(`/api/chapters/${params.chapterId}/placeholders`)
      if (res.ok) setPlaceholders(await res.json())
    } catch { /* ignore */ }
  }

  async function saveConfigPrompts() {
    setSavingConfig(true)
    try {
      const prompts = Object.entries(configFormData).map(([type, content]) => ({ type, content }))
      const res = await fetch(`/api/chapters/${params.chapterId}/config-prompts`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompts }),
      })
      if (res.ok) {
        toast.success("AI config saved")
      } else {
        toast.error("Error saving AI config")
      }
    } catch {
      toast.error("Network error")
    } finally {
      setSavingConfig(false)
    }
  }

  async function deletePrompt(promptId: string) {
    if (!confirm("Delete this prompt?")) return
    const res = await fetch(`/api/prompts/${promptId}`, { method: "DELETE" })
    if (res.ok) {
      setPrompts((prev) => prev.filter((p) => p.id !== promptId))
      fetchPlaceholders()
      toast.success("Prompt deleted")
    } else {
      toast.error("Error deleting prompt")
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="py-20 text-center">
        <p className="text-destructive mb-4">{error}</p>
      </div>
    )
  }

  const contentPrompts = prompts.filter((p) => !p.isAssembly)
  const assemblyPrompt = prompts.find((p) => p.isAssembly)

  return (
    <div className="py-6">
      <Breadcrumbs
        items={[
          { label: "Templates", href: "/templates" },
          { label: bookName || "...", href: `/templates/${params.id}` },
          { label: chapterTitle || "..." },
        ]}
      />

      <div className="mt-6 mb-8">
        <h1 className="text-2xl font-bold">{chapterTitle}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {prompts.length} prompts
        </p>
      </div>

      {prompts.length === 0 && !addingPrompt && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <h2 className="text-lg font-medium mb-1">No prompts configured</h2>
          <p className="text-sm text-muted-foreground max-w-sm mb-4">
            Add prompts to this chapter template.
          </p>
          <Button variant="outline" size="sm" onClick={() => setAddingPrompt(true)}>
            <Plus className="h-3 w-3 mr-1" /> Add Prompt
          </Button>
        </div>
      )}

      {/* Content Prompts */}
      {contentPrompts.length > 0 && (
        <div className="space-y-3 mb-6">
          <h2 className="text-sm font-medium text-muted-foreground">
            Content Prompts
          </h2>
          {contentPrompts.map((prompt) => {
            const data = getFormData(prompt.id, prompt)
            return (
              <Card key={prompt.id}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground font-mono">
                        {prompt.position + 1}.
                      </span>
                      <CardTitle className="text-sm">
                        {prompt.title}
                      </CardTitle>
                      {saving[prompt.id] && (
                        <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                      )}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-xs"
                        onClick={() =>
                          setShowVersions((prev) => ({
                            ...prev,
                            [prompt.id]: !prev[prompt.id],
                          }))
                        }
                      >
                        Versions
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                        onClick={() => deletePrompt(prompt.id)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="border-t pt-3 space-y-3">
                  {showVersions[prompt.id] && (
                    <VersionHistory
                      versionsApiUrl={`/api/prompts/${prompt.id}/versions`}
                      promptId={prompt.id}
                    />
                  )}
                  <div className="space-y-1.5">
                    <Label className="text-[10px] text-muted-foreground">Title</Label>
                    <Input
                      value={data.title}
                      onChange={(e) => {
                        setPromptFormData((prev) => ({
                          ...prev,
                          [prompt.id]: { ...data, title: e.target.value },
                        }))
                      }}
                      className="text-xs h-8"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[10px] text-muted-foreground">Content</Label>
                    <Textarea
                      value={data.content}
                      onChange={(e) => {
                        setPromptFormData((prev) => ({
                          ...prev,
                          [prompt.id]: { ...data, content: e.target.value },
                        }))
                      }}
                      className="text-xs min-h-[100px]"
                      placeholder="Prompt content..."
                    />
                  </div>
                  <div className="flex justify-end">
                    <Button
                      size="sm"
                      className="text-xs"
                      onClick={() => savePrompt(prompt.id)}
                      disabled={saving[prompt.id]}
                    >
                      {saving[prompt.id] ? (
                        <Loader2 className="h-3 w-3 animate-spin mr-1" />
                      ) : (
                        <Save className="h-3 w-3 mr-1" />
                      )}
                      Save
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Add Content Prompt (between content and assembly) */}
      {(prompts.length > 0 || addingPrompt) && (
      <div className="mb-8">
        {addingPrompt && !addingAssembly ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">New Prompt</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-[10px] text-muted-foreground">Title</Label>
                <Input
                  value={newPrompt.title}
                  onChange={(e) =>
                    setNewPrompt((prev) => ({ ...prev, title: e.target.value }))
                  }
                  className="text-xs h-8"
                  placeholder="Prompt title"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[10px] text-muted-foreground">Content</Label>
                <Textarea
                  value={newPrompt.content}
                  onChange={(e) =>
                    setNewPrompt((prev) => ({ ...prev, content: e.target.value }))
                  }
                  className="text-xs min-h-[100px]"
                  placeholder="Prompt content with {tema} placeholder..."
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs"
                  onClick={() => {
                    setAddingPrompt(false)
                    setNewPrompt({ title: "", content: "" })
                  }}
                >
                  <X className="h-3 w-3 mr-1" /> Cancel
                </Button>
                <Button size="sm" className="text-xs" onClick={() => createPrompt(false)}>
                  <Check className="h-3 w-3 mr-1" /> Save
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => {
              setNewPrompt({ title: "", content: "" })
              setAddingAssembly(false)
              setAddingPrompt(true)
            }}
          >
            <Plus className="h-3 w-3 mr-1" /> Add Content Prompt
          </Button>
        )}
      </div>
      )}

      {/* Placeholders */}
      {placeholders.length > 0 && (
        <div className="mb-6">
          <h2 className="text-sm font-medium text-muted-foreground mb-3">
            Placeholders
          </h2>
          <Card>
            <CardContent className="pt-4 space-y-2">
              {placeholders.map((ph) => {
                const count = prompts.filter((p) => p.content.includes(`{${ph.name}}`)).length
                return (
                  <div key={ph.id} className="flex items-center justify-between text-sm">
                    <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
                      {"{"}{ph.name}{"}"}
                    </code>
                    <span className="text-xs text-muted-foreground">
                      {count} prompt{count !== 1 ? "s" : ""} use this
                    </span>
                  </div>
                )
              })}
              <p className="text-[10px] text-muted-foreground pt-2">
                Values are defined at the project level.
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* AI Configuration */}
      <div className="mb-6">
        <h2 className="text-sm font-medium text-muted-foreground mb-3">AI Configuration</h2>
        <Card>
          <CardContent className="pt-4 space-y-3">
            <div className="space-y-1.5">
              <Label className="text-[10px] text-muted-foreground">
                Placeholder Fill Prompt
              </Label>
              <Textarea
                value={configFormData["fill_placeholders"] ?? ""}
                onChange={(e) => setConfigFormData((prev) => ({ ...prev, fill_placeholders: e.target.value }))}
                className="text-xs min-h-[80px]"
                placeholder="System prompt for filling placeholders with AI..."
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10px] text-muted-foreground">
                Brief Generation Prompt
              </Label>
              <Textarea
                value={configFormData["generate_brief"] ?? ""}
                onChange={(e) => setConfigFormData((prev) => ({ ...prev, generate_brief: e.target.value }))}
                className="text-xs min-h-[80px]"
                placeholder="System prompt for generating chapter briefs with AI..."
              />
            </div>
            <div className="flex justify-end">
              <Button size="sm" className="text-xs" onClick={saveConfigPrompts} disabled={savingConfig}>
                {savingConfig ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Save className="h-3 w-3 mr-1" />}
                Save
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Assembly Prompt */}
      <div className="mb-8">
        <h2 className="text-sm font-medium text-muted-foreground mb-3">Assembly</h2>
        {assemblyPrompt ? (() => {
          const data = getFormData(assemblyPrompt.id, assemblyPrompt)
          return (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground font-mono">
                      {assemblyPrompt.position + 1}.
                    </span>
                    <CardTitle className="text-sm">
                      {assemblyPrompt.title}
                    </CardTitle>
                    {saving[assemblyPrompt.id] && (
                      <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-xs"
                      onClick={() =>
                        setShowVersions((prev) => ({
                          ...prev,
                          [assemblyPrompt.id]: !prev[assemblyPrompt.id],
                        }))
                      }
                    >
                      Versions
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                      onClick={() => deletePrompt(assemblyPrompt.id)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="border-t pt-3 space-y-3">
                {showVersions[assemblyPrompt.id] && (
                  <VersionHistory
                    versionsApiUrl={`/api/prompts/${assemblyPrompt.id}/versions`}
                    promptId={assemblyPrompt.id}
                  />
                )}
                <div className="space-y-1.5">
                  <Label className="text-[10px] text-muted-foreground">Title</Label>
                  <Input
                    value={data.title}
                    onChange={(e) => {
                      setPromptFormData((prev) => ({
                        ...prev,
                        [assemblyPrompt.id]: { ...data, title: e.target.value },
                      }))
                    }}
                    className="text-xs h-8"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[10px] text-muted-foreground">Content</Label>
                  <Textarea
                    value={data.content}
                    onChange={(e) => {
                      setPromptFormData((prev) => ({
                        ...prev,
                        [assemblyPrompt.id]: { ...data, content: e.target.value },
                      }))
                    }}
                    className="text-xs min-h-[100px]"
                    placeholder="Assembly prompt content..."
                  />
                </div>
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    className="text-xs"
                    onClick={() => savePrompt(assemblyPrompt.id)}
                    disabled={saving[assemblyPrompt.id]}
                  >
                    {saving[assemblyPrompt.id] ? (
                      <Loader2 className="h-3 w-3 animate-spin mr-1" />
                    ) : (
                      <Save className="h-3 w-3 mr-1" />
                    )}
                    Save
                  </Button>
                </div>
              </CardContent>
            </Card>
          )
        })() : addingPrompt && addingAssembly ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">New Assembly Prompt</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-[10px] text-muted-foreground">Title</Label>
                <Input
                  value={newPrompt.title}
                  onChange={(e) =>
                    setNewPrompt((prev) => ({ ...prev, title: e.target.value }))
                  }
                  className="text-xs h-8"
                  placeholder="Assembly prompt title"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[10px] text-muted-foreground">Content</Label>
                <Textarea
                  value={newPrompt.content}
                  onChange={(e) =>
                    setNewPrompt((prev) => ({ ...prev, content: e.target.value }))
                  }
                  className="text-xs min-h-[100px]"
                  placeholder="Assembly prompt content..."
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs"
                  onClick={() => {
                    setAddingPrompt(false)
                    setAddingAssembly(false)
                    setNewPrompt({ title: "", content: "" })
                  }}
                >
                  <X className="h-3 w-3 mr-1" /> Cancel
                </Button>
                <Button size="sm" className="text-xs" onClick={() => createPrompt(true)}>
                  <Check className="h-3 w-3 mr-1" /> Save
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className="border-dashed">
            <CardContent className="py-8 text-center">
              <p className="text-sm text-muted-foreground mb-3">
                No assembly prompt configured yet.
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setNewPrompt({
                    title: "Assembly",
                    content: "{tema}\n\nAssembles the fragments...",
                  })
                  setAddingAssembly(true)
                  setAddingPrompt(true)
                }}
              >
                <Plus className="h-3 w-3 mr-1" /> Add Assembly Prompt
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
