# Admin Pages — Implementation Plan

**Goal:** Rewrite PromptEditor and ChapterEditor with shadcn components + react-hook-form. Redesign book template pages with modern cards, semantic badges, and skeleton loading.

**Architecture:** PromptEditor uses react-hook-form + zod for validation. ChapterEditor gains card redesign with Badge components. Books list uses animated grid (like projects). Chapter prompt page gets skeleton loading.

---

### Task 1: Rewrite PromptEditor with shadcn + react-hook-form

**Files:**
- Modify: `components/prompts/prompt-editor.tsx`

Full rewrite:
- Use shadcn Select for prompt type (with proper SelectItem for each type)
- Use shadcn Input for title
- Use shadcn Textarea for content, styleRules, knowledgeAreas
- Use shadcn Input for suggestedLength
- Use shadcn Button for save/delete
- Add react-hook-form with zod schema
- Badge for prompt type display
- Collapsible advanced fields (styleRules, knowledgeAreas, suggestedLength)
- Better layout: card with clear sections

```tsx
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

  const { register, handleSubmit, setValue, watch, formState: { isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      type: prompt.type as typeof PROMPT_TYPES[number],
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
    const updated = await res.json()
    onSave(updated)
  }

  async function handleDelete() {
    setDeleting(true)
    await fetch(`/api/prompts/${prompt.id}`, { method: "DELETE" })
    onDelete(prompt.id)
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-3">
          <Select
            defaultValue={prompt.type}
            onValueChange={(v) => setValue("type", v as typeof PROMPT_TYPES[number])}
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
          <div className="flex-1">
            <input
              {...register("title")}
              placeholder="Prompt title"
              className="w-full bg-transparent text-sm font-medium border-0 border-b border-transparent hover:border-border focus:border-primary focus:outline-none focus:ring-0 px-1 py-0.5"
            />
          </div>
          <Badge variant="secondary" className="text-xs">
            {currentType}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-medium text-muted-foreground">Content</label>
            <button
              type="button"
              onClick={insertTopic}
              className="text-xs px-2 py-0.5 bg-muted rounded hover:bg-accent transition-colors"
            >
              Insert [TEMA]
            </button>
          </div>
          <Textarea
            {...register("content")}
            rows={10}
            className="font-mono text-sm"
          />
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
              <label className="text-xs font-medium text-muted-foreground">Style Rules</label>
              <Textarea {...register("styleRules")} rows={3} className="text-sm" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Knowledge Areas</label>
              <Textarea {...register("knowledgeAreas")} rows={3} className="text-sm" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Suggested Length</label>
              <Input {...register("suggestedLength")} className="text-sm" />
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
            <Trash2 className="h-4 w-4 mr-1" />
            Delete
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={handleSubmit(onSubmit)}
            disabled={isSubmitting}
          >
            {isSubmitting && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
            <Save className="h-4 w-4 mr-1" />
            Save
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
```

Commit: `feat: rewrite PromptEditor with shadcn components and react-hook-form`

---

### Task 2: Redesign ChapterEditor with modern card + Badge components

**Files:**
- Modify: `components/prompts/chapter-editor.tsx`

Upgrade:
- Use shadcn Card
- Use Badge for prompt types (not plain `<span>`)
- Better layout with position badge, title, edit link
- Use shadcn Input for inline title editing (blur to save)

Commit: `feat: redesign ChapterEditor with shadcn Card and Badge components`

---

### Task 3: Enhance chapter prompt editor page

**Files:**
- Modify: `app/admin/books/[id]/chapters/[chapterId]/page.tsx`

Upgrade:
- Skeleton loading (show placeholder cards while fetching)
- "Add Prompt" button styled as shadcn Button with Plus icon
- Better empty state
- AnimatePresence when prompts are added/removed (Motion)

Commit: `feat: enhance chapter prompt page with skeleton loading and animations`

---

### Task 4: Redesign book detail page + books list

**Files:**
- Modify: `app/admin/books/[id]/page.tsx`
- Modify: `app/admin/books/page.tsx`

Book detail:
- Better header with book metadata
- ChapterEditor list with "Add Chapter" button
- Position numbers displayed

Books list:
- Grid layout (like projects)
- Card per template with chapter count
- "New Template" button styled with shadcn Button

Commit: `feat: redesign book detail and books list with modern cards`

---

### Task 5: Build verification

1. `pnpm typecheck` — must pass
2. `pnpm build` — CSS must compile

Work from: /Users/diegocarvajal/Documents/Programming/redactor-v4
