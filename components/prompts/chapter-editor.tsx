"use client";

import { useState } from "react";
import Link from "next/link";
import type { Chapter, Prompt } from "@/lib/db/schema";

interface ChapterWithPrompts extends Chapter {
  prompts: Prompt[];
}

export function ChapterEditor({
  bookId,
  chapter,
}: {
  bookId: string;
  chapter: ChapterWithPrompts;
}) {
  const [title, setTitle] = useState(chapter.title);

  async function saveTitle() {
    await fetch(`/api/chapters/${chapter.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
  }

  return (
    <div className="border rounded-lg p-4">
      <div className="flex items-center gap-2 mb-3">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={saveTitle}
          className="font-medium bg-transparent border-b border-transparent hover:border-border focus:border-primary focus:outline-none px-1"
        />
        <Link
          href={`/admin/books/${bookId}/chapters/${chapter.id}`}
          className="text-xs text-muted-foreground hover:text-foreground ml-auto"
        >
          Edit prompts ({chapter.prompts.length})
        </Link>
      </div>
      <div className="text-xs text-muted-foreground">
        {chapter.prompts.map((p) => (
          <span key={p.id} className="inline-block mr-2 mb-1 px-2 py-0.5 bg-muted rounded">
            {p.type}
          </span>
        ))}
      </div>
    </div>
  );
}
