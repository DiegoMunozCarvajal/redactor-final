"use client"

import { useState } from "react"
import Link from "next/link"
import type { Chapter, Prompt } from "@/lib/db/schema"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Pencil } from "lucide-react"

interface ChapterWithPrompts extends Chapter {
  prompts: Prompt[]
}

export function ChapterEditor({
  bookId,
  chapter,
}: {
  bookId: string
  chapter: ChapterWithPrompts
}) {
  const [title, setTitle] = useState(chapter.title)

  async function saveTitle() {
    await fetch(`/api/chapters/${chapter.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    })
  }

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-3">
          <span className="text-xs tabular-nums text-muted-foreground font-medium w-6 text-center">
            {chapter.position}
          </span>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={saveTitle}
            className="flex-1 border-0 border-b border-transparent hover:border-border focus-visible:border-primary focus-visible:ring-0 rounded-none px-1 h-8 text-sm font-medium bg-transparent"
          />
          <div className="flex items-center gap-1.5 flex-wrap min-w-0 overflow-hidden">
            {chapter.prompts.slice(0, 4).map((p) => (
              <Badge key={p.id} variant="secondary" className="text-xs shrink-0">
                {p.type}
              </Badge>
            ))}
            {chapter.prompts.length > 4 && (
              <span className="text-xs text-muted-foreground shrink-0">
                +{chapter.prompts.length - 4}
              </span>
            )}
          </div>
          <Link
            href={`/templates/${bookId}/chapters/${chapter.id}`}
            className="shrink-0 text-xs text-muted-foreground hover:text-primary transition-colors flex items-center gap-1"
          >
            <Pencil className="h-3 w-3" />
            Edit
          </Link>
        </div>
      </CardContent>
    </Card>
  )
}
