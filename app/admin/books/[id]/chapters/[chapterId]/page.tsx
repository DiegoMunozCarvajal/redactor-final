"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { PromptEditor } from "@/components/prompts/prompt-editor";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import type { Prompt } from "@/lib/db/schema";

export default function ChapterPromptEditorPage() {
  const params = useParams<{ id: string; chapterId: string }>();
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [chapterTitle, setChapterTitle] = useState("");
  const [bookName, setBookName] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch(`/api/chapters/${params.chapterId}/prompts`)
        .then((r) => r.json())
        .then(setPrompts),
      fetch(`/api/chapters/${params.chapterId}`)
        .then((r) => r.json())
        .then((ch) => setChapterTitle(ch.title ?? "")),
      fetch(`/api/books/${params.id}`)
        .then((r) => r.json())
        .then((b) => setBookName(b.name ?? "")),
    ]).finally(() => setLoading(false));
  }, [params.chapterId, params.id]);

  async function addPrompt() {
    const pos = prompts.length;
    const res = await fetch(`/api/chapters/${params.chapterId}/prompts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "apertura", title: "Nuevo prompt", content: "[TEMA]", position: pos }),
    });
    const p = await res.json();
    if (res.ok) setPrompts([...prompts, p]);
  }

  if (loading) return <div className="p-6">Loading...</div>;

  return (
    <div className="max-w-4xl mx-auto">
      <Breadcrumbs
        items={[
          { label: "Admin", href: "/admin/books" },
          { label: bookName || "...", href: `/admin/books/${params.id}` },
          { label: chapterTitle || "..." },
        ]}
      />
      <h1 className="text-xl font-bold mb-6">{chapterTitle} — Prompts</h1>

      <div className="space-y-6">
        {prompts.map((p) => (
          <PromptEditor
            key={p.id}
            prompt={p}
            onSave={(updated) =>
              setPrompts((prev) => prev.map((x) => (x.id === updated.id ? updated : x)))
            }
            onDelete={(id) => setPrompts((prev) => prev.filter((x) => x.id !== id))}
          />
        ))}
      </div>

      <button
        onClick={addPrompt}
        className="mt-4 w-full py-3 border-2 border-dashed rounded-lg text-sm text-muted-foreground hover:text-foreground hover:border-foreground transition-colors"
      >
        + Add Prompt
      </button>
    </div>
  );
}
