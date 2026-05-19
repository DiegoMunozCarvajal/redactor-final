"use client"

import { useEffect, useState } from "react"
import { useParams } from "next/navigation"
import { AnimatePresence, motion } from "motion/react"
import { PromptEditor } from "@/components/prompts/prompt-editor"
import { Breadcrumbs } from "@/components/ui/breadcrumbs"
import { Button } from "@/components/ui/button"
import { Plus, Loader2 } from "lucide-react"
import type { Prompt } from "@/lib/db/schema"

export default function ChapterPromptEditorPage() {
  const params = useParams<{ id: string; chapterId: string }>()
  const [prompts, setPrompts] = useState<Prompt[]>([])
  const [chapterTitle, setChapterTitle] = useState("")
  const [bookName, setBookName] = useState("")
  const [loading, setLoading] = useState(true)

  const [error, setError] = useState<string | null>(null)

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
    ])
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load") })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [params.chapterId, params.id])

  const [adding, setAdding] = useState(false)

  async function addPrompt() {
    setAdding(true)
    try {
      const pos = prompts.length
      const res = await fetch(`/api/chapters/${params.chapterId}/prompts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "apertura",
          title: "Nuevo prompt",
          content: "[TEMA]",
          position: pos,
        }),
      })
      const p = await res.json()
      if (res.ok) setPrompts([...prompts, p])
    } finally {
      setAdding(false)
    }
  }

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto space-y-6 animate-pulse">
        {[1, 2, 3].map((i) => (
          <div key={i} className="border rounded-lg p-6 space-y-3">
            <div className="h-5 bg-muted rounded w-1/3" />
            <div className="h-32 bg-muted rounded" />
            <div className="h-4 bg-muted rounded w-1/4" />
          </div>
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <div className="max-w-4xl mx-auto p-6 text-center py-20">
        <p className="text-destructive mb-4">{error}</p>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto">
      <Breadcrumbs
        items={[
          { label: "Templates", href: "/templates" },
          { label: bookName || "...", href: `/templates/${params.id}` },
          { label: chapterTitle || "..." },
        ]}
      />
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold">{chapterTitle}</h1>
          <p className="text-sm text-muted-foreground">{prompts.length} prompts</p>
        </div>
      </div>

      <div className="space-y-4">
        <AnimatePresence mode="popLayout">
          {prompts.map((p) => (
            <motion.div
              key={p.id}
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2 }}
            >
              <PromptEditor
                prompt={p}
                onSave={(updated) =>
                  setPrompts((prev) => prev.map((x) => (x.id === updated.id ? updated : x)))
                }
                onDelete={(id) => setPrompts((prev) => prev.filter((x) => x.id !== id))}
              />
            </motion.div>
          ))}
        </AnimatePresence>

        <Button
          variant="outline"
          className="w-full border-dashed"
          onClick={addPrompt}
          disabled={adding}
        >
          {adding ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Plus className="h-4 w-4" />
          )}
          Add Prompt
        </Button>
      </div>
    </div>
  )
}
