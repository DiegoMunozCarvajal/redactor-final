"use client"

import { useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import type { Prompt } from "@/lib/db/schema"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Loader2, Save, Trash2 } from "lucide-react"

const schema = z.object({
  title: z.string().min(1, "Required"),
  content: z.string().min(1, "Required"),
  isAssembly: z.boolean(),
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
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { register, handleSubmit, setValue, watch, formState: { isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      isAssembly: prompt.isAssembly,
      title: prompt.title,
      content: prompt.content,
    },
  })

  function insertPlaceholder(placeholder: string) {
    const current = watch("content")
    setValue("content", current + " " + placeholder)
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
          <input
            {...register("title")}
            placeholder="Prompt title"
            className="flex-1 bg-transparent text-sm font-medium border-0 border-b border-transparent hover:border-border focus:border-primary focus:outline-none focus:ring-0 px-1 py-0.5"
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label htmlFor={`content-${prompt.id}`} className="text-xs font-medium text-muted-foreground">Content</label>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => insertPlaceholder("[TEMA]")}
                className="text-xs px-2 py-0.5 bg-muted rounded hover:bg-accent transition-colors"
              >
                + [TEMA]
              </button>
              <button
                type="button"
                onClick={() => insertPlaceholder("[SUBTITLE]")}
                className="text-xs px-2 py-0.5 bg-muted rounded hover:bg-accent transition-colors"
              >
                + [SUBTITLE]
              </button>
            </div>
          </div>
          <Textarea id={`content-${prompt.id}`} {...register("content")} rows={10} className="font-mono text-sm" />
        </div>

        <div className="flex justify-between items-center pt-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleDelete}
            disabled={deleting}
            className="text-muted-foreground hover:text-destructive hover:bg-destructive/10"
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
