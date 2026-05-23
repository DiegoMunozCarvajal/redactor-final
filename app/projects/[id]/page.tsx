"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { AddChapterDialog } from "@/components/projects/add-chapter-dialog";
import { SortableChapterList } from "@/components/projects/sortable-chapter-list";
import { Loader2, Check, X, BookOpen, Save, Sparkles } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { MODEL_OPTIONS, EFFORT_OPTIONS } from "@/lib/ai/providers";

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
  description: string | null;
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
  const [description, setDescription] = useState("");
  const [savingDescription, setSavingDescription] = useState(false);
  const [descModel, setDescModel] = useState("deepseek-v4-pro");
  const [descEffort, setDescEffort] = useState<string>("off");
  const [descTemperature, setDescTemperature] = useState(0.7);
  const [generatingDescription, setGeneratingDescription] = useState(false);
  const fetchingRef = useRef(false);
  const pollErrorCount = useRef(0);

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

  async function generateDescription() {
    if (!project) return;
    setGeneratingDescription(true);
    try {
      const res = await fetch(`/api/projects/${params.id}/description/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: descModel, effort: descEffort, temperature: descTemperature }),
      });
      if (res.ok) {
        const data = await res.json();
        setDescription(data.description);
        setProject({ ...project, description: data.description });
        toast.success("Description generated");
      } else {
        toast.error("Error generating description");
      }
    } catch {
      toast.error("Network error");
    } finally {
      setGeneratingDescription(false);
    }
  }

  async function saveDescription() {
    if (!project) return;
    setSavingDescription(true);
    try {
      const res = await fetch(`/api/projects/${params.id}/description`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description }),
      });
      if (res.ok) {
        const updated = await res.json();
        setProject({ ...project, description: updated.description });
        toast.success("Description saved");
      } else {
        toast.error("Error saving description");
      }
    } catch {
      toast.error("Network error");
    } finally {
      setSavingDescription(false);
    }
  }

  // Sync description and topic from project data when it loads/changes
  useEffect(() => {
    if (project) {
      setDescription(project.description ?? "");
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

      {/* Description */}
      <div className="space-y-2 mb-6">
        <Label className="text-xs text-muted-foreground">Description</Label>
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="text-xs min-h-[80px]"
          placeholder="What is this book about? This helps the AI understand context for filling placeholders..."
        />
        <div className="flex justify-end gap-2">
          <Select value={descModel} onValueChange={setDescModel}>
            <SelectTrigger className="w-[110px] h-7 text-[10px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MODEL_OPTIONS.map((m) => (
                <SelectItem key={m.id} value={m.id} className="text-[10px]">{m.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={descEffort} onValueChange={setDescEffort}>
            <SelectTrigger className="w-[70px] h-7 text-[10px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EFFORT_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value} className="text-[10px]">{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {descEffort === "off" && (
            <Input
              type="number"
              min={0}
              max={1}
              step={0.1}
              value={descTemperature}
              onChange={(e) => { const v = parseFloat(e.target.value); setDescTemperature(isNaN(v) ? 0.7 : v); }}
              className="w-[60px] h-7 text-[10px] px-1"
            />
          )}
          <Button
            size="sm"
            variant="outline"
            className="text-xs"
            onClick={generateDescription}
            disabled={generatingDescription}
          >
            {generatingDescription ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Sparkles className="h-3 w-3 mr-1" />}
            Generate
          </Button>
          <Button size="sm" className="text-xs" onClick={saveDescription} disabled={savingDescription}>
            {savingDescription ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Save className="h-3 w-3 mr-1" />}
            Save
          </Button>
        </div>
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
