"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { GenerateChapterButton } from "@/components/projects/generate-chapter-button";
import { AddChapterDialog } from "@/components/projects/add-chapter-dialog";
import { Loader2, Pencil, Check, X, BookOpen, Trash2 } from "lucide-react";
import { toast } from "sonner";

interface GenerationData {
  id: string;
  status: string;
  assembledContent: string | null;
  error: string | null;
  createdAt: string;
}

interface ChapterData {
  id: string;
  position: number;
  title: string;
  latestGeneration: GenerationData | null;
}

interface ProjectData {
  id: string;
  name: string;
  topic: string;
  title: string | null;
  subtitle: string | null;
  chapters: ChapterData[];
}

function statusBadge(status: string) {
  switch (status) {
    case "completed":
      return (
        <Badge className="bg-success/10 text-success border-success/20">
          Completado
        </Badge>
      );
    case "generating":
      return (
        <Badge className="bg-info/10 text-info border-info/20">
          Generando
        </Badge>
      );
    case "failed":
      return <Badge variant="destructive">Fallido</Badge>;
    default:
      return <Badge variant="secondary">{status}</Badge>;
  }
}

export default function ProjectPage() {
  const params = useParams<{ id: string }>();
  const [project, setProject] = useState<ProjectData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [editingSubtitle, setEditingSubtitle] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editSubtitle, setEditSubtitle] = useState("");
  const [editingChapterId, setEditingChapterId] = useState<string | null>(null);
  const [editChapterTitle, setEditChapterTitle] = useState("");
  const fetchingRef = useRef(false);

  async function fetchProject(signal?: AbortSignal) {
    try {
      const res = await fetch(`/api/projects/${params.id}`, { signal });
      if (signal?.aborted) return;
      if (!res.ok) throw new Error(`Failed to load (${res.status})`);
      const data = await res.json();
      setProject(data);
    } catch (err) {
      if (signal?.aborted) return;
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    fetchProject(controller.signal);
    return () => controller.abort();
  }, [params.id]);

  // Poll if any chapter is generating
  useEffect(() => {
    if (!project) return;
    const hasGenerating = project.chapters.some(
      (ch) => ch.latestGeneration?.status === "generating",
    );
    if (!hasGenerating) return;

    const interval = setInterval(() => {
      if (fetchingRef.current) return;
      fetchingRef.current = true;
      fetchProject().finally(() => { fetchingRef.current = false; });
    }, 3000);
    return () => clearInterval(interval);
  }, [project]);

  async function saveTitle() {
    if (!project) return;
    const res = await fetch(`/api/projects/${project.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: editTitle }),
    });
    if (res.ok) {
      setProject({ ...project, title: editTitle });
      setEditingTitle(false);
    } else {
      toast.error("Error saving title");
    }
  }

  async function saveSubtitle() {
    if (!project) return;
    const res = await fetch(`/api/projects/${project.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subtitle: editSubtitle }),
    });
    if (res.ok) {
      setProject({ ...project, subtitle: editSubtitle });
      setEditingSubtitle(false);
    } else {
      toast.error("Error saving subtitle");
    }
  }

  async function deleteChapter(chapterId: string) {
    if (!project) return;
    const res = await fetch(`/api/projects/${project.id}/chapters/${chapterId}`, {
      method: "DELETE",
    });
    if (res.ok) {
      setProject({
        ...project,
        chapters: project.chapters.filter((ch) => ch.id !== chapterId),
      });
    } else {
      toast.error("Error deleting chapter");
    }
  }

  async function saveChapterTitle(chapterId: string) {
    if (!project) return;
    const res = await fetch(`/api/projects/${project.id}/chapters/${chapterId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: editChapterTitle }),
    });
    if (res.ok) {
      setProject({
        ...project,
        chapters: project.chapters.map((ch) =>
          ch.id === chapterId ? { ...ch, title: editChapterTitle } : ch,
        ),
      });
      setEditingChapterId(null);
    } else {
      toast.error("Error saving chapter title");
    }
  }

  if (loading)
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );

  if (error || !project) {
    return (
      <div className="max-w-4xl mx-auto p-6 text-center py-20">
        <p className="text-destructive mb-4">{error ?? "Project not found"}</p>
        <Link href="/projects" className="text-sm text-primary hover:underline">
          Back to projects
        </Link>
      </div>
    );
  }

  const completedCount = project.chapters.filter(
    (ch) => ch.latestGeneration?.status === "completed",
  ).length;

  return (
    <div className="max-w-4xl mx-auto p-6">
      <Breadcrumbs
        items={[
          { label: "Projects", href: "/projects" },
          { label: project.name },
        ]}
      />

      {/* Title section */}
      <div className="mt-4 mb-6">
        {editingTitle ? (
          <div className="flex items-center gap-2 mb-1">
            <Input
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              className="text-2xl font-bold h-auto py-1"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") saveTitle();
                if (e.key === "Escape") setEditingTitle(false);
              }}
            />
            <Button size="icon" variant="ghost" onClick={saveTitle}>
              <Check className="h-4 w-4" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              onClick={() => setEditingTitle(false)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">
              {project.title ?? project.name}
            </h1>
            <Button
              size="icon"
              variant="ghost"
              onClick={() => {
                setEditTitle(project.title ?? "");
                setEditingTitle(true);
              }}
            >
              <Pencil className="h-4 w-4 text-muted-foreground" />
            </Button>
          </div>
        )}

        {editingSubtitle ? (
          <div className="flex items-center gap-2 mt-1">
            <Input
              value={editSubtitle}
              onChange={(e) => setEditSubtitle(e.target.value)}
              className="text-muted-foreground h-auto py-1"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") saveSubtitle();
                if (e.key === "Escape") setEditingSubtitle(false);
              }}
            />
            <Button size="icon" variant="ghost" onClick={saveSubtitle}>
              <Check className="h-4 w-4" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              onClick={() => setEditingSubtitle(false)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            {project.subtitle && (
              <p className="text-muted-foreground">{project.subtitle}</p>
            )}
            <Button
              size="icon"
              variant="ghost"
              onClick={() => {
                setEditSubtitle(project.subtitle ?? "");
                setEditingSubtitle(true);
              }}
            >
              <Pencil className="h-3 w-3 text-muted-foreground" />
            </Button>
          </div>
        )}
      </div>

      {/* Progress */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <BookOpen className="h-4 w-4" />
          <span>
            {completedCount}/{project.chapters.length} capítulos completados
          </span>
        </div>
        <AddChapterDialog
          projectId={project.id}
          onChapterAdded={fetchProject}
        />
      </div>

      {/* Chapters */}
      <div className="space-y-4">
        {project.chapters.map((ch) => (
          <Card key={ch.id}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {editingChapterId === ch.id ? (
                    <div className="flex items-center gap-2">
                      <Input
                        value={editChapterTitle}
                        onChange={(e) => setEditChapterTitle(e.target.value)}
                        className="text-base font-semibold h-auto py-1 w-auto"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveChapterTitle(ch.id);
                          if (e.key === "Escape") setEditingChapterId(null);
                        }}
                      />
                      <Button size="icon" variant="ghost" onClick={() => saveChapterTitle(ch.id)}>
                        <Check className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" onClick={() => setEditingChapterId(null)}>
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : (
                    <>
                      <Link
                        href={`/projects/${project.id}/chapters/${ch.id}`}
                        className="hover:underline"
                      >
                        <CardTitle className="text-base">
                          {ch.title}
                        </CardTitle>
                      </Link>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6"
                        onClick={() => {
                          setEditChapterTitle(ch.title);
                          setEditingChapterId(ch.id);
                        }}
                      >
                        <Pencil className="h-3 w-3 text-muted-foreground" />
                      </Button>
                      {ch.latestGeneration &&
                        statusBadge(ch.latestGeneration.status)}
                    </>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <GenerateChapterButton
                    projectId={project.id}
                    chapterId={ch.id}
                    hasGeneration={ch.latestGeneration !== null}
                    onGenerationStarted={fetchProject}
                  />
                  <Link
                    href={`/projects/${project.id}/chapters/${ch.id}/prompts`}
                  >
                    <Button variant="ghost" size="icon" className="text-muted-foreground">
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </Link>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => deleteChapter(ch.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardHeader>
          </Card>
        ))}
      </div>
    </div>
  );
}
