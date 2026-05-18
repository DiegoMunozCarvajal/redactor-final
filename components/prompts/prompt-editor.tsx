"use client"

import { useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import type { Prompt } from "@/lib/db/schema"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { ChevronDown, ChevronUp, Loader2, Save, Trash2 } from "lucide-react"

const PROMPT_TYPES = [
  "apertura", "modelo", "contraste", "amplificacion",
  "anecdota", "acumulacion", "proceso", "cierre", "ensamblaje",
] as const

const schema = z.object({
  type: z.enum(PROMPT_TYPES),
  title: z.string().min(1, "Required"),
  content: z.string().min(1, "Required"),
  styleRules: z.string().optional(),
  knowledgeAreas: z.string().optional(),
  suggestedLength: z.string().optional(),
})

type FormData = z.infer<typeof schema>

export function PromptEditor({
  prompt,
  onSave,
  onDelete,
}: {
  prompt: Prompt
  onSave: (p: Prompt) => void
  onDelete: (id: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { register, handleSubmit, setValue, watch, formState: { isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      type: prompt.type as (typeof PROMPT_TYPES)[number],
      title: prompt.title,
      content: prompt.content,
      styleRules: prompt.styleRules ?? "",
      knowledgeAreas: prompt.knowledgeAreas ?? "",
      suggestedLength: prompt.suggestedLength ?? "",
    },
  })

  const currentType = watch("type")

  function insertTopic() {
    const current = watch("content")
    setValue("content", current + " [TEMA]")
  }

  async function onSubmit(data: FormData) {
    const res = await fetch(`/api/prompts/${prompt.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Save failed" }))
      setError(err.error ?? "Save failed")
      return
    }
    const updated = await res.json()
    onSave(updated)
  }

  async function handleDelete() {
    setDeleting(true)
    try {
      await fetch(`/api/prompts/${prompt.id}`, { method: "DELETE" })
      onDelete(prompt.id)
    } catch {
      setDeleting(false)
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-3">
          <Select
            value={currentType}
            onValueChange={(v) => setValue("type", v as (typeof PROMPT_TYPES)[number])}
          >
            <SelectTrigger className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PROMPT_TYPES.map((t) => (
                <SelectItem key={t} value={t}>{t}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <input
            {...register("title")}
            placeholder="Prompt title"
            className="flex-1 bg-transparent text-sm font-medium border-0 border-b border-transparent hover:border-border focus:border-primary focus:outline-none focus:ring-0 px-1 py-0.5"
          />
          <Badge variant="secondary" className="text-xs shrink-0">
            {currentType}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label htmlFor={`content-${prompt.id}`} className="text-xs font-medium text-muted-foreground">Content</label>
            <button
              type="button"
              onClick={insertTopic}
              className="text-xs px-2 py-0.5 bg-muted rounded hover:bg-accent transition-colors"
            >
              Insert [TEMA]
            </button>
          </div>
          <Textarea id={`content-${prompt.id}`} {...register("content")} rows={10} className="font-mono text-sm" />
        </div>

        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          Advanced
        </button>

        {expanded && (
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label htmlFor={`styleRules-${prompt.id}`} className="text-xs font-medium text-muted-foreground">Style Rules</label>
              <Textarea id={`styleRules-${prompt.id}`} {...register("styleRules")} rows={3} className="text-sm" />
            </div>
            <div className="space-y-1.5">
              <label htmlFor={`knowledgeAreas-${prompt.id}`} className="text-xs font-medium text-muted-foreground">Knowledge Areas</label>
              <Textarea id={`knowledgeAreas-${prompt.id}`} {...register("knowledgeAreas")} rows={3} className="text-sm" />
            </div>
            <div className="space-y-1.5">
              <label htmlFor={`suggestedLength-${prompt.id}`} className="text-xs font-medium text-muted-foreground">Suggested Length</label>
              <Input id={`suggestedLength-${prompt.id}`} {...register("suggestedLength")} className="text-sm" />
            </div>
          </div>
        )}

        <div className="flex justify-between items-center pt-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleDelete}
            disabled={deleting}
            className="text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
            Delete
          </Button>
          <div className="flex items-center gap-2">
            {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
            <Button type="submit" size="sm" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
              <Save className="h-4 w-4" />
              Save
            </Button>
          </div>
        </div>
        </form>
      </CardContent>
    </Card>
  )
}
