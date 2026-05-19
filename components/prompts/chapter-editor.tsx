"use client"

import Link from "next/link"
import type { Chapter, Prompt } from "@/lib/db/schema"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Trash2 } from "lucide-react"

interface ChapterWithPrompts extends Chapter {
  prompts: Prompt[]
}

export function ChapterEditor({
  bookId,
  chapter,
  onDelete,
}: {
  bookId: string
  chapter: ChapterWithPrompts
  onDelete?: (id: string) => void
}) {
  return (
    <Link href={`/templates/${bookId}/chapters/${chapter.id}`} className="block">
      <Card className="hover:bg-accent/50 transition-colors cursor-pointer">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <span className="text-xs text-muted-foreground font-mono">
                {chapter.position + 1}.
              </span>
              <CardTitle className="text-sm">
                {chapter.title}
              </CardTitle>
            </div>
            {onDelete && (
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10 shrink-0 ml-3"
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  onDelete(chapter.id)
                }}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            )}
          </div>
        </CardHeader>
      </Card>
    </Link>
  )
}
