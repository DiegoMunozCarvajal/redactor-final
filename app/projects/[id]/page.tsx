"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AddChapterDialog } from "@/components/projects/add-chapter-dialog";
import { SortableChapterList } from "@/components/projects/sortable-chapter-list";
import { Loader2, Check, X, BookOpen, Library } from "lucide-react";
import { cn } from "@/lib/utils";
import { SourcesManager } from "@/components/projects/sources-manager";
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
}export default function ProjectPage() {
  const params = useParams<{ id: string }>();
  const [project, setProject] = useState<ProjectData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editingTopic, setEditingTopic] = useState(false);
  const [editTopic, setEditTopic] = useState("");
  const fetchingRef = useRef(false);
  const pollErrorCount = useRef(0);
  const [activeTab, setActiveTab] = useState<"chapters" | "sources">("chapters");

  async function fetchProject(signal?: AbortSignal) {
    try {
      const res = await fetch(`/api/projects/${params.id}`, { signal });
      if (signal?.aborted) return;
      if (!res.ok) throw new Error(`Failed to load (${res.status})`);
      const data = await res.json();
      setProject(data);
      setError(null);
      pollErrorCount.current = 0;
    } catch (err) {
      if (signal?.aborted) return;
      // During polling, transient errors are retried; only set fatal error without signal
      if (!signal) {
        pollErrorCount.current++;
        if (pollErrorCount.current < 3) return; // retry up to 3 times
      }
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
      window.dispatchEvent(new CustomEvent("project-renamed", { detail: { id: project.id, title: editTitle } }));
      setEditingTitle(false);
    } else {
      toast.error("Error saving title");
    }
  }

  async function saveTopic() {
    if (!project) return;
    const res = await fetch(`/api/projects/${project.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic: editTopic }),
    });
    if (res.ok) {
      setProject({ ...project, topic: editTopic });
      setEditingTopic(false);
    } else {
      toast.error("Error saving topic");
    }
  }

  // Sync topic from project data when it loads/changes
  useEffect(() => {
    if (project) {
      setEditTopic(project.topic ?? "");
    }
  }, [project?.id]);

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
          { label: project.title || project.name },
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

      {/* Topic */}
      <div className="mb-4">
        <Label className="text-xs text-muted-foreground">Topic</Label>
        {editingTopic ? (
          <div className="flex items-center gap-2 mt-1">
            <Input
              value={editTopic}
              onChange={(e) => setEditTopic(e.target.value)}
              className="text-sm h-auto py-1"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") saveTopic();
                if (e.key === "Escape") setEditingTopic(false);
              }}
            />
            <Button size="icon" variant="ghost" onClick={saveTopic}>
              <Check className="h-4 w-4" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              onClick={() => {
                setEditTopic(project?.topic ?? "");
                setEditingTopic(false);
              }}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <p
            className="text-sm cursor-pointer hover:text-primary/80 transition-colors mt-1"
            onClick={() => {
              setEditTopic(project?.topic ?? "");
              setEditingTopic(true);
            }}
            title="Click to edit topic"
          >
            {project?.topic || (
              <span className="text-muted-foreground italic">Click to set the book topic</span>
            )}
          </p>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border mb-6">
        <button
          onClick={() => setActiveTab("chapters")}
          className={cn(
            "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
            activeTab === "chapters"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          <BookOpen className="h-4 w-4 inline mr-2" />
          Capítulos
        </button>
        <button
          onClick={() => setActiveTab("sources")}
          className={cn(
            "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
            activeTab === "sources"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          <Library className="h-4 w-4 inline mr-2" />
          Fuentes RAG
        </button>
      </div>

      {activeTab === "chapters" && (
        <>
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
        </>
      )}

      {activeTab === "sources" && (
        <SourcesManager projectId={project.id} />
      )}
    </div>
  );
}
