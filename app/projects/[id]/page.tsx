"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AddChapterDialog } from "@/components/projects/add-chapter-dialog";
import { SortableChapterList } from "@/components/projects/sortable-chapter-list";
import { Loader2, Check, X, BookOpen } from "lucide-react";
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

export default function ProjectPage() {
  const params = useParams<{ id: string }>();
  const [project, setProject] = useState<ProjectData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [editTitle, setEditTitle] = useState("");
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

  if (loading)
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );

  if (error || !project) {
    return (
      <div className="py-20 text-center">
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
    <div className="py-6">
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
          <h1 className="text-2xl font-bold">
            <span
              className="cursor-pointer hover:text-primary/80 transition-colors"
              onClick={() => {
                setEditTitle(project.title || project.name || "");
                setEditingTitle(true);
              }}
              title="Click to edit"
            >
            {project.title || project.name}
            </span>
          </h1>
        )}
      </div>

      {/* Progress */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground mb-6">
        <BookOpen className="h-4 w-4" />
        <span>
          {completedCount}/{project.chapters.length} chapters completed
        </span>
      </div>

      {/* Chapters */}
      <SortableChapterList
        chapters={project.chapters}
        projectId={project.id}
        onDelete={deleteChapter}
      />

      <div className="mt-4">
        <AddChapterDialog
          projectId={project.id}
          onChapterAdded={fetchProject}
        />
      </div>
    </div>
  );
}
