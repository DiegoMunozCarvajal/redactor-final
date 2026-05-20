"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card";
import { Loader2, ArrowLeft, Trash2 } from "lucide-react";

interface ProjectPrompt {
  id: string;
  chapterId: string;
  position: number;
  isAssembly: boolean;
  title: string;
  content: string;
}

export default function PromptEditPage() {
  const params = useParams<{ id: string; chapterId: string; promptId: string }>();
  const router = useRouter();
  const [prompt, setPrompt] = useState<ProjectPrompt | null>(null);
  const [projectName, setProjectName] = useState("");
  const [chapterTitle, setChapterTitle] = useState("");
  const [chapterPosition, setChapterPosition] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        // Fetch chapter detail (has projectName, chapter info)
        const chRes = await fetch(
          `/api/projects/${params.id}/chapters/${params.chapterId}`,
          { signal: controller.signal },
        );
        if (!chRes.ok) throw new Error(`Failed (${chRes.status})`);
        const chData = await chRes.json();
        if (controller.signal.aborted) return;
        setProjectName(chData.projectName);
        setChapterTitle(chData.chapter.title);
        setChapterPosition(chData.chapter.position);

        // Fetch all prompts for this chapter
        const pRes = await fetch(
          `/api/projects/${params.id}/prompts?chapterId=${params.chapterId}`,
          { signal: controller.signal },
        );
        if (!pRes.ok) throw new Error(`Failed (${pRes.status})`);
        const prompts: ProjectPrompt[] = await pRes.json();
        if (controller.signal.aborted) return;

        const found = prompts.find((p) => p.id === params.promptId);
        if (!found) throw new Error("Prompt not found");
        setPrompt(found);
      } catch (err) {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Failed to load");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    load();
    return () => controller.abort();
  }, [params.id, params.chapterId, params.promptId]);

  async function saveContent(value: string) {
    if (!prompt || value === prompt.content) return;
    setSaving(true);
    await fetch(`/api/projects/${params.id}/prompts/${prompt.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: value }),
    });
    setPrompt((prev) => prev ? { ...prev, content: value } : prev);
    setSaving(false);
  }

  async function deletePrompt() {
    if (!prompt) return;
    setDeleting(true);
    await fetch(`/api/projects/${params.id}/prompts/${prompt.id}`, {
      method: "DELETE",
    });
    router.push(`/projects/${params.id}/chapters/${params.chapterId}`);
  }

  if (loading)
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );

  if (error || !prompt) {
    return (
      <div className="py-20 text-center">
        <p className="text-destructive">{error ?? "Prompt not found"}</p>
        <Link
          href={`/projects/${params.id}/chapters/${params.chapterId}`}
          className="text-sm text-primary hover:underline"
        >
          Back to chapter
        </Link>
      </div>
    );
  }

  return (
    <div className="py-6">
      <Breadcrumbs
        items={[
          { label: "Projects", href: "/projects" },
          { label: projectName || "Project", href: `/projects/${params.id}` },
          { label: `Capítulo ${chapterPosition + 1}`, href: `/projects/${params.id}/chapters/${params.chapterId}` },
          { label: prompt.title },
        ]}
      />

      <div className="flex items-center gap-3 mt-4 mb-6">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => router.push(`/projects/${params.id}/chapters/${params.chapterId}`)}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-xl font-bold">{prompt.title}</h1>
          <p className="text-xs text-muted-foreground">
            {prompt.isAssembly ? "Assembly prompt" : `Prompt ${prompt.position + 1}`} · {chapterTitle}
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">Content</CardTitle>
            <div className="flex items-center gap-2">
              {saving && (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              )}
              <Button
                size="icon"
                variant="ghost"
                className="text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                onClick={deletePrompt}
                disabled={deleting}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Textarea
            key={prompt.id}
            defaultValue={prompt.content}
            onBlur={(e) => saveContent(e.target.value)}
            rows={20}
            className="text-sm font-mono"
          />
        </CardContent>
      </Card>
    </div>
  );
}
