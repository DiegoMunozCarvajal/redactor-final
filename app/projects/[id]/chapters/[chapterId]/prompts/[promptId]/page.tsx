"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card";
import { Loader2, ArrowLeft, Trash2, Save } from "lucide-react";

interface ChapterDetail {
  projectName: string;
  projectTopic: string | null;
  chapter: {
    id: string;
    position: number;
    title: string;
    chapterNumber: number;
  };
}

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
  const [chapterNumber, setChapterNumber] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
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
        const chData: ChapterDetail = await chRes.json();
        if (controller.signal.aborted) return;
        setProjectName(chData.projectName);
        setChapterTitle(chData.chapter.title);
        setChapterNumber(chData.chapter.chapterNumber);

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
        setContent(found.content);
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

  async function saveContent() {
    if (!prompt || content === prompt.content) return;
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch(`/api/projects/${params.id}/prompts/${prompt.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      setPrompt((prev) => prev ? { ...prev, content } : prev);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      setError("Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function deletePrompt() {
    if (!prompt) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/projects/${params.id}/prompts/${prompt.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      router.push(`/projects/${params.id}/chapters/${params.chapterId}`);
    } catch {
      setError("Failed to delete prompt");
      setDeleting(false);
    }
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
          { label: `Capítulo ${chapterNumber}`, href: `/projects/${params.id}/chapters/${params.chapterId}` },
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
              {saved && (
                <span className="text-xs text-green-600">Saved</span>
              )}
              {saving && (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              )}
              <Button
                size="sm"
                variant="default"
                onClick={saveContent}
                disabled={saving || content === prompt.content}
              >
                <Save className="h-4 w-4 mr-1" />
                Save
              </Button>
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
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={20}
            className="text-sm font-mono"
          />
        </CardContent>
      </Card>
    </div>
  );
}
