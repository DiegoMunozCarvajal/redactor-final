"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Loader2,
  BookOpen,
  AlertTriangle,
  Check,
  X,
  Trash2,
  Play,
  Plus,
  RotateCcw,
  Save,
  History,
  Copy,
  Puzzle,
} from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { enUS } from "date-fns/locale";
import { AVAILABLE_MODELS } from "@/lib/ai/providers";
import { AssemblyPromptSection } from "@/components/prompts/assembly-prompt-section";
import { EFFORT_OPTIONS } from "@/lib/ai/providers";
import { VersionHistory } from "@/components/prompts/version-history";
import { PlaceholderFillSection } from "@/components/projects/placeholder-fill-section";
import type { ChapterPlaceholder } from "@/lib/db/schema";

const MODEL_FIXED_TEMP = new Map(
  AVAILABLE_MODELS.filter((m) => m.fixedTemperature !== undefined).map((m) => [
    m.id,
    m.fixedTemperature as number,
  ]),
);

const MODELS = [
  { id: "gpt-5.4", label: "GPT 5.4", short: "GPT 5.4" },
  { id: "gpt-5.4-mini", label: "GPT 5.4 Mini", short: "GPT4 Mini" },
  { id: "gpt-5.5", label: "GPT 5.5", short: "GPT 5.5" },
  { id: "gpt-5.5-mini", label: "GPT 5.5 Mini", short: "GPT5 Mini" },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", short: "Haiku" },
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", short: "Sonnet" },
  { id: "claude-opus-4-6", label: "Claude Opus 4.6", short: "Opus 4.6" },
  { id: "claude-opus-4-7", label: "Claude Opus 4.7", short: "Opus" },
  { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", short: "Gem Pro" },
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", short: "Gem Flash" },
  { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro", short: "DS Pro" },
  { id: "deepseek-v4-flash", label: "DeepSeek V4 Flash", short: "DS Flash" },
];

const DEFAULT_MODEL = "deepseek-v4-pro";

interface FragmentData {
  id: string;
  position: number;
  content: string | null;
  modelUsed: string | null;
  tokensUsed: number | null;
  isAssembly: boolean;
  projectPromptId?: string;
  createdAt?: string;
}

interface GenerationData {
  id: string;
  status: string;
  assembledContent: string | null;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
  fragments: FragmentData[];
}

interface ChapterDetail {
  projectName: string;
  projectTopic: string;
  chapter: {
    id: string;
    position: number;
    title: string;
  };
  generations: GenerationData[];
}

interface PromptData {
  id: string;
  chapterId: string;
  position: number;
  isAssembly: boolean;
  title: string;
  content: string;
}

function statusBadge(status: string) {
  switch (status) {
    case "completed":
      return <Badge className="bg-success/10 text-success border-success/20">Completed</Badge>;
    case "generating":
      return <Badge className="bg-info/10 text-info border-info/20">Generating</Badge>;
    case "failed":
      return <Badge variant="destructive">Failed</Badge>;
    case "awaiting_assembly":
      return <Badge className="bg-warning/10 text-warning border-warning/20">Awaiting Assembly</Badge>;
    default:
      return <Badge variant="secondary">{status}</Badge>;
  }
}

export default function ChapterPage() {
  const params = useParams<{ id: string; chapterId: string }>();
  const router = useRouter();
  const [data, setData] = useState<ChapterDetail | null>(null);
  const [prompts, setPrompts] = useState<PromptData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [generatingPrompts, setGeneratingPrompts] = useState<Set<string>>(new Set());
  const [defaultModel, setDefaultModel] = useState(DEFAULT_MODEL);
  const [promptModels, setPromptModels] = useState<Record<string, string>>({});
  const [defaultTemperature, setDefaultTemperature] = useState(0.7);
  const [promptTemperatures, setPromptTemperatures] = useState<Record<string, number>>({});
  const [defaultEffort, setDefaultEffort] = useState<string>("max");
  const [promptEfforts, setPromptEfforts] = useState<Record<string, string>>({});
  const [assemblyEffort, setAssemblyEffort] = useState<string>("max");
  const [assemblyModalOpen, setAssemblyModalOpen] = useState(false);
  const [selectedFragments, setSelectedFragments] = useState<Record<string, string>>({});
  const [assemblyModel, setAssemblyModel] = useState(DEFAULT_MODEL);
  const [assemblyTemperature, setAssemblyTemperature] = useState(0.7);
  const [assembling, setAssembling] = useState(false);
  const [selectingAssembly, setSelectingAssembly] = useState(false);
  const [assemblyPromptId, setAssemblyPromptId] = useState<string>("");
  const [assemblyPromptList, setAssemblyPromptList] = useState<{ id: string; name: string; description: string | null }[]>([]);
  const [selectedFragmentVersion, setSelectedFragmentVersion] = useState<Record<string, string | undefined>>({});
  const fetchingRef = useRef(false);
  const pollErrorCount = useRef(0);
  const [placeholders, setPlaceholders] = useState<ChapterPlaceholder[]>([]);
  const [editingPromptId, setEditingPromptId] = useState<string | null>(null);
  const [addingPrompt, setAddingPrompt] = useState(false);
  const [newPrompt, setNewPrompt] = useState({
    title: "",
    content: "",
  });
  const [promptFormData, setPromptFormData] = useState<Record<string, {
    content: string;
  }>>({});
  const [showPromptVersions, setShowPromptVersions] = useState<Record<string, boolean>>({});

  function getModel(promptId: string) {
    return promptModels[promptId] ?? defaultModel;
  }

  function getTemperature(promptId: string) {
    return promptTemperatures[promptId] ?? defaultTemperature;
  }

  function getEffort(promptId: string) {
    return promptEfforts[promptId] ?? defaultEffort;
  }

  function fixedTempFor(modelId: string): number | undefined {
    return MODEL_FIXED_TEMP.get(modelId);
  }

  const fetchChapter = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch(
        `/api/projects/${params.id}/chapters/${params.chapterId}`,
        { signal },
      );
      if (signal?.aborted) return;
      if (!res.ok) throw new Error(`Failed to load (${res.status})`);
      setData(await res.json());
      setError(null);
      pollErrorCount.current = 0;
    } catch (err) {
      if (signal?.aborted) return;
      // During polling, transient errors are retried; only set fatal error without signal
      if (!signal) {
        pollErrorCount.current++;
        if (pollErrorCount.current < 3) return;
      }
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  }, [params.id, params.chapterId]);

  const fetchPrompts = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch(
        `/api/projects/${params.id}/prompts?chapterId=${params.chapterId}`,
        { signal },
      );
      if (signal?.aborted) return;
      if (res.ok) setPrompts(await res.json());
    } catch {
      // prompts are supplementary, don't block on error
    }
  }, [params.id, params.chapterId]);

  const fetchPlaceholders = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch(
        `/api/projects/${params.id}/chapters/${params.chapterId}/placeholders`,
        { signal },
      );
      if (signal?.aborted) return;
      if (res.ok) {
        setPlaceholders(await res.json());
      }
    } catch { /* supplementary */ }
  }, [params.id, params.chapterId]);

  const fetchAssemblyLibrary = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch("/api/assembly-prompts", { signal });
      if (signal?.aborted) return;
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) setAssemblyPromptList(data);
      }
    } catch { /* supplementary */ }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      fetchChapter(controller.signal),
      fetchPrompts(controller.signal),
      fetchPlaceholders(controller.signal),
      fetchAssemblyLibrary(controller.signal),
    ]);
    return () => controller.abort();
  }, [fetchChapter, fetchPrompts, fetchPlaceholders, fetchAssemblyLibrary]);

  async function saveChapterTitle() {
    if (!data) return;
    const res = await fetch(`/api/projects/${params.id}/chapters/${params.chapterId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: editTitle }),
    });
    if (res.ok) {
      setData({
        ...data,
        chapter: { ...data.chapter, title: editTitle },
      });
      setEditingTitle(false);
    } else {
      toast.error("Error saving chapter title");
    }
  }

  async function runPrompt(promptId: string) {
    setGeneratingPrompts((prev) => new Set(prev).add(promptId));
    try {
      const res = await fetch(
        `/api/projects/${params.id}/prompts/${promptId}/generate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: getModel(promptId),
            effort: getEffort(promptId),
            ...(getEffort(promptId) === "off" ? { temperature: getTemperature(promptId) } : {}),
          }),
        },
      );
      if (res.ok) {
        fetchChapter();
        toast.success("Fragment generated");
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error ?? "Error generating fragment");
      }
    } catch {
      toast.error("Network error");
    } finally {
      setGeneratingPrompts((prev) => {
        const next = new Set(prev);
        next.delete(promptId);
        return next;
      });
    }
  }

  async function runAllPrompts() {
    const contentPrompts = prompts.filter((p) => !p.isAssembly);
    for (const prompt of contentPrompts) {
      await runPrompt(prompt.id);
      // Small delay between triggers
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  async function runAssembly() {
    const fragmentIds = Object.values(selectedFragments).filter(Boolean);
    if (fragmentIds.length === 0) {
      toast.error("Select at least one fragment");
      return;
    }
    // If no embedded assembly prompt, require assemblyPromptId
    if (!assemblyPrompt && !assemblyPromptId) {
      toast.error("Select an assembly prompt");
      return;
    }
    setAssembling(true);
    try {
      const res = await fetch(
        `/api/projects/${params.id}/chapters/${params.chapterId}/assemble`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fragmentIds,
            model: assemblyModel,
            effort: assemblyEffort,
            ...(assemblyEffort === "off" ? { temperature: assemblyTemperature } : {}),
            ...(assemblyPromptId ? { assemblyPromptId } : {}),
          }),
        },
      );
      if (res.ok) {
        setAssemblyModalOpen(false);
        fetchChapter();
        toast.success("Assembly completed");
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error ?? "Assembly error");
      }
    } catch {
      toast.error("Network error");
    } finally {
      setAssembling(false);
    }
  }

  async function savePromptField(promptId: string, field: string, value: string) {
    try {
      const res = await fetch(`/api/projects/${params.id}/prompts/${promptId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value }),
      });
      if (!res.ok) toast.error(`Error saving ${field}`);
    } catch {
      toast.error("Network error");
    }
  }

  async function deletePrompt(promptId: string) {
    if (!confirm("Delete this prompt?")) return;
    const res = await fetch(`/api/projects/${params.id}/prompts/${promptId}`, {
      method: "DELETE",
    });
    if (res.ok) {
      fetchPrompts();
      setEditingPromptId(null);
      toast.success("Prompt deleted");
    } else {
      toast.error("Error deleting prompt");
    }
  }

  async function saveDefinition(name: string, definition: string) {
    try {
      const res = await fetch(
        `/api/projects/${params.id}/chapters/${params.chapterId}/placeholders`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ placeholders: { [name]: definition } }),
        },
      );
      if (res.ok) {
        setPlaceholders(await res.json());
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error ?? "Error saving placeholder");
      }
    } catch {
      toast.error("Network error");
    }
  }

  async function createPrompt() {
    const { title, content } = newPrompt;
    if (!title || !content) {
      toast.error("Title and content are required");
      return;
    }
    const res = await fetch(`/api/projects/${params.id}/prompts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chapterId: params.chapterId,
        title,
        content,
      }),
    });
    if (res.ok) {
      fetchPrompts();
      setAddingPrompt(false);
      setNewPrompt({ title: "", content: "" });
      toast.success("Prompt added");
    } else {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error ?? "Error adding prompt");
    }
  }

  // Initialize prompt form data when prompts load
  useEffect(() => {
    setPromptFormData(prev => {
      const next = { ...prev };
      for (const p of prompts) {
        if (!next[p.id]) {
          next[p.id] = {
            content: p.content,
          };
        }
      }
      return next;
    });
  }, [prompts]);

  // Poll if any generation is in progress (skip stale generations > 30 min old)
  useEffect(() => {
    if (!data) return;
    const STALE_MS = 30 * 60 * 1000;
    const hasGenerating = data.generations.some(
      (g) => g.status === "generating" && Date.now() - new Date(g.createdAt).getTime() < STALE_MS,
    );
    if (!hasGenerating) return;

    const interval = setInterval(() => {
      if (fetchingRef.current) return;
      fetchingRef.current = true;
      fetchChapter().finally(() => { fetchingRef.current = false; });
    }, 3000);
    return () => clearInterval(interval);
  }, [data]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="py-20 text-center">
        <p className="text-destructive mb-4">{error ?? "Chapter not found"}</p>
        <Link href="/projects" className="text-sm text-primary hover:underline">
          Back to projects
        </Link>
      </div>
    );
  }

  const { chapter, generations, projectName } = data;
  const STALE_MS = 30 * 60 * 1000;
  const activeGen = generations.find(
    (g) => g.status === "generating" && Date.now() - new Date(g.createdAt).getTime() < STALE_MS,
  );

  // Build a map of prompt ID → fragment for the active generation
  const promptFragmentMap = new Map<string, FragmentData>();
  if (activeGen) {
    for (const f of activeGen.fragments) {
      if (f.projectPromptId) {
        promptFragmentMap.set(f.projectPromptId, f);
      }
    }
  }

  // Build fragment versions across ALL generations grouped by prompt ID
  const fragmentVersions = new Map<string, FragmentData[]>();
  const latestFragmentByPrompt = new Map<string, FragmentData>();
  for (const gen of generations) {
    for (const f of gen.fragments) {
      if (!f.projectPromptId || !f.content) continue;
      const list = fragmentVersions.get(f.projectPromptId) ?? [];
      list.push(f);
      fragmentVersions.set(f.projectPromptId, list);
      // Track latest fragment per prompt (fragments are iterated in gen order, newest first)
      if (!latestFragmentByPrompt.has(f.projectPromptId)) {
        latestFragmentByPrompt.set(f.projectPromptId, f);
      }
    }
  }

  async function handleSelectAssemblyPrompt(libraryId: string) {
    setSelectingAssembly(true);
    try {
      // Fetch the library prompt
      const res = await fetch(`/api/assembly-prompts/${libraryId}`);
      if (!res.ok) {
        toast.error("Failed to load assembly prompt");
        return;
      }
      const ap = await res.json();
      // Create as project prompt for this chapter
      const createRes = await fetch(`/api/projects/${params.id}/prompts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chapterId: params.chapterId,
          title: ap.name,
          content: ap.content,
          userPrompt: ap.userPrompt ?? null,
          isAssembly: true,
        }),
      });
      if (createRes.ok) {
        toast.success(`Assembly prompt "${ap.name}" added`);
        fetchPrompts();
      } else {
        const err = await createRes.json().catch(() => ({}));
        toast.error(err.error ?? "Failed to add assembly prompt");
      }
    } catch {
      toast.error("Network error");
    } finally {
      setSelectingAssembly(false);
    }
  }

  function openAssemblyModal() {
    // Pre-select the latest fragment for each content prompt
    const sel: Record<string, string> = {};
    for (const [promptId, versions] of fragmentVersions) {
      if (versions.length > 0) {
        // fragments are iterated newest-first, so index 0 = latest version
        sel[promptId] = versions[0].id;
      }
    }
    setSelectedFragments(sel);

    // If no embedded assembly prompt, fetch assembly prompts for the picker
    if (!assemblyPrompt) {
      fetch("/api/assembly-prompts")
        .then((r) => r.json())
        .then((data) => {
          if (Array.isArray(data)) setAssemblyPromptList(data);
        })
        .catch(() => {});
    }

    setAssemblyModalOpen(true);
  }

  const contentPrompts = prompts.filter((p) => !p.isAssembly);
  const assemblyPrompt = prompts.find((p) => p.isAssembly);
  const totalContentDone = contentPrompts.filter(
    (p) => promptFragmentMap.has(p.id),
  ).length;

  const totalTokens = generations.reduce((sum, g) => {
    return sum + g.fragments.reduce((s, f) => s + (f.tokensUsed ?? 0), 0);
  }, 0);

  return (
    <div className="py-6">
      <Breadcrumbs
        items={[
          { label: "Projects", href: "/projects" },
          { label: projectName, href: `/projects/${params.id}` },
          { label: `Chapter ${chapter.position + 1}: ${chapter.title}` },
        ]}
      />

      <div className="mt-6 mb-8">
        {editingTitle ? (
          <div className="flex items-center gap-2 mb-1">
            <Input
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              className="text-2xl font-bold h-auto py-1"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") saveChapterTitle();
                if (e.key === "Escape") setEditingTitle(false);
              }}
            />
            <Button size="icon" variant="ghost" onClick={saveChapterTitle}>
              <Check className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="ghost" onClick={() => setEditingTitle(false)}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-3 mb-1">
            <BookOpen className="h-5 w-5 text-muted-foreground" />
            <h1
              className="text-2xl font-bold cursor-pointer hover:text-primary/70 transition-colors"
              onClick={() => {
                setEditTitle(chapter.title);
                setEditingTitle(true);
              }}
            >
              {chapter.title}
            </h1>
          </div>
        )}
        <div className="text-sm text-muted-foreground mt-1">
          {totalTokens > 0 ? `${totalTokens.toLocaleString()} tokens` : "No generations"}
          {activeGen && (
            <>
              {" "}· {statusBadge("generating")}{" "}
              <span className="text-xs">
                ({totalContentDone}/{contentPrompts.length} prompts)
              </span>
            </>
          )}
        </div>
      </div>

      {/* Generation error — show from any failed generation */}
      {(() => {
        const failedGen = generations.find((g) => g.status === "failed" && g.error);
        if (!failedGen?.error) return null;
        return (
          <Card className="mb-6 border-destructive/30">
            <CardContent className="pt-4">
              <p className="text-sm text-destructive bg-destructive/5 rounded-md p-3">
                {failedGen.error}
              </p>
            </CardContent>
          </Card>
        );
      })()}

      <PlaceholderFillSection
        projectId={params.id as string}
        chapterId={params.chapterId as string}
        placeholders={placeholders}
        onSaveDefinition={saveDefinition}
      />

      {/* No prompts */}
      {prompts.length === 0 && !addingPrompt && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <AlertTriangle className="h-10 w-10 text-muted-foreground/40 mb-3" />
          <h2 className="text-lg font-medium mb-1">No prompts configured</h2>
          <p className="text-sm text-muted-foreground max-w-sm mb-4">
            Add prompts to start generating content for this chapter.
          </p>
          <Button variant="outline" size="sm" onClick={() => setAddingPrompt(true)}>
            <Plus className="h-3 w-3 mr-1" /> Add Prompt
          </Button>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground">Default:</span>
          <Select value={defaultModel} onValueChange={(v) => {
            setDefaultModel(v);
            const fixed = fixedTempFor(v);
            if (fixed !== undefined) setDefaultTemperature(fixed);
          }}>
            <SelectTrigger className="w-[170px] h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MODELS.map((m) => (
                <SelectItem key={m.id} value={m.id} className="text-xs">
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={defaultEffort} onValueChange={setDefaultEffort}>
            <SelectTrigger className="w-[70px] h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="max" className="text-xs">Max</SelectItem>
              {EFFORT_OPTIONS.map((o) => (<SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>))}
            </SelectContent>
          </Select>
          {defaultEffort === "off" && (
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-muted-foreground">T:</span>
              {(() => {
                const fixed = fixedTempFor(defaultModel);
                return (
                  <input
                    type="number"
                    min="0"
                    max="1"
                    step="0.1"
                    value={fixed ?? defaultTemperature}
                    disabled={fixed !== undefined}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      if (!isNaN(v) && v >= 0 && v <= 1) setDefaultTemperature(v);
                    }}
                    className={`w-14 h-7 text-xs border rounded px-1.5 text-center ${
                      fixed !== undefined
                        ? "bg-muted/30 text-muted-foreground cursor-not-allowed border-muted"
                        : "bg-muted/50 border-border"
                    }`}
                    title={fixed !== undefined ? `Temperature fixed at ${fixed} for this model` : undefined}
                  />
                );
              })()}
            </div>
          )}
          {contentPrompts.length > 0 && (
            <Button
              size="sm"
              onClick={runAllPrompts}
              disabled={generatingPrompts.size > 0}
            >
              {generatingPrompts.size > 0 ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : (
                <Play className="h-4 w-4 mr-1" />
              )}
              Generate All
            </Button>
          )}
        </div>
      </div>

      {/* Content Prompts */}
      {contentPrompts.length > 0 && (
        <div className="space-y-3 mb-8">
          <h2 className="text-sm font-medium text-muted-foreground">
            Content Prompts
          </h2>
          {contentPrompts.map((prompt) => {
            const activeFragment = promptFragmentMap.get(prompt.id);
            const latestFragment = latestFragmentByPrompt.get(prompt.id);
            const versions = fragmentVersions.get(prompt.id) ?? [];
            const selectedVersionId = selectedFragmentVersion[prompt.id];
            const fragment = selectedVersionId
              ? versions.find((v) => v.id === selectedVersionId) ?? (activeFragment ?? latestFragment)
              : (activeFragment ?? latestFragment);
            const isGenerating = generatingPrompts.has(prompt.id);
            const isDone = !!fragment;

            return (
              <Card
                key={prompt.id}
                className={`${isDone ? "border-success/20" : ""} cursor-pointer hover:border-primary/30 transition-colors`}
                onClick={() => router.push(`/projects/${params.id}/chapters/${params.chapterId}/prompts/${prompt.id}`)}
              >
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground font-mono">
                        {prompt.position + 1}.
                      </span>
                      <CardTitle className="text-sm">
                        {prompt.title}
                      </CardTitle>
                      {isDone && (
                        <Badge className="bg-success/10 text-success border-success/20 text-[10px]">
                          Ready
                        </Badge>
                      )}
                      {isGenerating && (
                        <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                      )}
                    </div>
                    <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                      <Select
                        value={getModel(prompt.id)}
                        onValueChange={(v) => {
                          setPromptModels((prev) => ({ ...prev, [prompt.id]: v }));
                          const fixed = fixedTempFor(v);
                          if (fixed !== undefined) {
                            setPromptTemperatures((prev) => ({
                              ...prev,
                              [prompt.id]: fixed,
                            }));
                          }
                        }}
                      >
                        <SelectTrigger className="w-[100px] h-7 text-[10px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {MODELS.map((m) => (
                            <SelectItem key={m.id} value={m.id} className="text-[10px]">
                              {m.short}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Select value={getEffort(prompt.id)} onValueChange={(v) => {
                        setPromptEfforts((prev) => ({ ...prev, [prompt.id]: v }));
                      }}>
                        <SelectTrigger className="w-[60px] h-7 text-[10px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="max" className="text-[10px]">Max</SelectItem>
                          {EFFORT_OPTIONS.map((o) => (<SelectItem key={o.value} value={o.value} className="text-[10px]">{o.label}</SelectItem>))}
                        </SelectContent>
                      </Select>
                      {getEffort(prompt.id) === "off" && (
                        (() => {
                          const fixed = fixedTempFor(getModel(prompt.id));
                          return (
                            <input
                              type="number"
                              min="0"
                              max="1"
                              step="0.1"
                              value={fixed ?? getTemperature(prompt.id)}
                              disabled={fixed !== undefined}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) => {
                                const v = parseFloat(e.target.value);
                                if (!isNaN(v) && v >= 0 && v <= 1) {
                                  setPromptTemperatures((prev) => ({
                                    ...prev,
                                    [prompt.id]: v,
                                  }));
                                }
                              }}
                              className={`w-12 h-7 text-[10px] border rounded px-1 text-center ${
                                fixed !== undefined
                                  ? "bg-muted/30 text-muted-foreground cursor-not-allowed border-muted"
                                  : "bg-muted/50 border-border"
                              }`}
                              title={fixed !== undefined ? `Temperature fixed at ${fixed} for this model` : undefined}
                            />
                          );
                        })()
                      )}
                      <Button
                        size="sm"
                        variant={isDone ? "outline" : "default"}
                        onClick={(e) => {
                          e.stopPropagation();
                          runPrompt(prompt.id);
                        }}
                        disabled={isGenerating}
                        className="h-7 text-xs"
                      >
                        {isGenerating ? (
                          <Loader2 className="h-3 w-3 animate-spin mr-1" />
                        ) : isDone ? (
                          <RotateCcw className="h-3 w-3 mr-1" />
                        ) : (
                          <Play className="h-3 w-3 mr-1" />
                        )}
                        {isDone ? "Regenerate" : "Generate"}
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-muted-foreground"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (fragment?.content) {
                            navigator.clipboard.writeText(fragment.content);
                            toast.success("Fragment copied");
                          }
                        }}
                        disabled={!fragment?.content}
                        title="Copy fragment"
                      >
                        <Copy className="h-3 w-3" />
                      </Button>
                      {prompt.id && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-xs"
                          onClick={(e) => {
                            e.stopPropagation();
                            setShowPromptVersions((prev) => ({
                              ...prev,
                              [prompt.id]: !prev[prompt.id],
                            }));
                          }}
                        >
                          <History className="h-3 w-3 mr-1" /> Versions
                        </Button>
                      )}
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                        onClick={(e) => {
                          e.stopPropagation();
                          deletePrompt(prompt.id);
                        }}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>

                {editingPromptId === prompt.id && (
                  <CardContent className="border-t pt-3 space-y-3">
                    <div className="space-y-1.5">
                      <Label className="text-[10px] text-muted-foreground">Content</Label>
                      <Textarea
                        value={promptFormData[prompt.id]?.content ?? prompt.content}
                        onChange={(e) => {
                          setPromptFormData(prev => ({
                            ...prev,
                            [prompt.id]: { ...(prev[prompt.id] || { content: prompt.content }), content: e.target.value }
                          }));
                        }}
                        onBlur={(e) => {
                          if (e.target.value !== (prompt.content)) {
                            savePromptField(prompt.id, "content", e.target.value);
                            setPrompts(prev => prev.map(p => p.id === prompt.id ? { ...p, content: e.target.value } : p));
                          }
                        }}
                        className="text-xs min-h-[100px]"
                        placeholder="Prompt content..."
                      />
                    </div>
                  </CardContent>
                )}

                {showPromptVersions[prompt.id] && prompt.id && (
                  <CardContent className="border-t pt-3" onClick={(e) => e.stopPropagation()}>
                    <VersionHistory
                      versionsApiUrl={`/api/projects/${params.id}/prompts/${prompt.id}/versions`}
                      promptId={prompt.id}
                    />
                  </CardContent>
                )}

                {fragment?.content && (
                  <CardContent>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                        {fragment.modelUsed && (
                          <span className="bg-muted px-1.5 py-0.5 rounded">
                            {fragment.modelUsed}
                          </span>
                        )}
                        {fragment.tokensUsed != null && (
                          <span>{fragment.tokensUsed.toLocaleString()} tokens</span>
                        )}
                      </div>
                      {versions.length > 1 && (
                        <div className="flex items-center gap-1">
                          <span className="text-[10px] text-muted-foreground mr-0.5">
                            v:
                          </span>
                          {versions.map((v, i) => (
                            <button
                              key={v.id}
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedFragmentVersion((prev) => ({
                                  ...prev,
                                  [prompt.id]:
                                    prev[prompt.id] === v.id ? undefined : v.id,
                                }));
                              }}
                              className={`text-[10px] px-1.5 py-0.5 rounded transition-colors ${
                                (selectedVersionId ?? latestFragment?.id) === v.id
                                  ? "bg-primary text-primary-foreground"
                                  : "bg-muted text-muted-foreground hover:bg-muted/70"
                              }`}
                            >
                              v{i + 1}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="prose prose-sm dark:prose-invert max-w-none text-sm">
                      <ReactMarkdown rehypePlugins={[rehypeSanitize]}>
                        {fragment.content}
                      </ReactMarkdown>
                    </div>
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* Add Prompt Button — hidden when empty state shows the same button */}
      {prompts.length > 0 || addingPrompt ? (
      <div className="mb-6">
        {addingPrompt ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">New Prompt</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-[10px] text-muted-foreground">Title</Label>
                <Input
                  value={newPrompt.title}
                  onChange={(e) => setNewPrompt(prev => ({ ...prev, title: e.target.value }))}
                  className="text-xs h-8"
                  placeholder="Prompt title"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[10px] text-muted-foreground">Content</Label>
                <Textarea
                  value={newPrompt.content}
                  onChange={(e) => setNewPrompt(prev => ({ ...prev, content: e.target.value }))}
                  className="text-xs min-h-[100px]"
                  placeholder="Prompt content with {tema} placeholder..."
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs"
                  onClick={() => {
                    setAddingPrompt(false);
                    setNewPrompt({ title: "", content: "" });
                  }}
                >
                  <X className="h-3 w-3 mr-1" /> Cancel
                </Button>
                <Button size="sm" className="text-xs" onClick={createPrompt}>
                  <Check className="h-3 w-3 mr-1" /> Save
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => setAddingPrompt(true)}
          >
            <Plus className="h-3 w-3 mr-1" /> Add Prompt
          </Button>
        )}
      </div>
      ) : null}

      {/* Assembly Results */}
      {generations.filter((g) => g.status === "completed" && g.assembledContent).length > 0 && (
        <div className="space-y-3 mb-8">
          <h2 className="text-sm font-medium text-muted-foreground">
            Assembly Results
          </h2>
          {generations
            .filter((g) => g.status === "completed" && g.assembledContent)
            .map((gen) => (
              <Card key={gen.id} className="border-success/20">
                <CardContent className="pt-4">
                  <div className="flex items-center gap-2 mb-3 text-[10px] text-muted-foreground">
                    {statusBadge(gen.status)}
                    {gen.completedAt && (
                      <span>
                        {formatDistanceToNow(new Date(gen.completedAt), {
                          addSuffix: true,
                          locale: enUS,
                        })}
                      </span>
                    )}
                    <div className="flex-1" />
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs"
                      onClick={() => {
                        navigator.clipboard.writeText(gen.assembledContent ?? "");
                        toast.success("Assembly copied");
                      }}
                    >
                      <Copy className="h-3 w-3 mr-1" /> Copy
                    </Button>
                  </div>
                  <div className="prose prose-sm dark:prose-invert max-w-none text-sm">
                    <ReactMarkdown rehypePlugins={[rehypeSanitize]}>
                      {gen.assembledContent!}
                    </ReactMarkdown>
                  </div>
                </CardContent>
              </Card>
            ))}
        </div>
      )}

      {!assemblyPrompt && contentPrompts.length > 0 && totalContentDone > 0 && (
        <div className="mb-8">
          <h2 className="text-sm font-medium text-muted-foreground mb-3">Assembly</h2>
          <Card className="border-dashed">
            <CardContent className="py-8 text-center">
              <Puzzle className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground mb-3">
                {activeGen?.status === "awaiting_assembly"
                  ? "Content generation complete. Ready to assemble."
                  : "No embedded assembly prompt. Select one to assemble this chapter."}
              </p>
              <Button
                variant="default"
                size="sm"
                onClick={openAssemblyModal}
              >
                <Play className="h-3 w-3 mr-1" /> Assemble Chapter
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      <AssemblyPromptSection
        prompt={assemblyPrompt}
        onSave={async (data) => {
          if (!assemblyPrompt) return
          await fetch(`/api/projects/${params.id}/prompts/${assemblyPrompt.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...data, isAssembly: true }),
          })
          fetchPrompts()
        }}
        versionsApiUrl={`/api/projects/${params.id}/prompts/${assemblyPrompt?.id}/versions`}
        assemblyLibrary={assemblyPromptList}
        onSelectFromLibrary={handleSelectAssemblyPrompt}
        selectingFromLibrary={selectingAssembly}
        models={MODELS}
        assemblyModel={assemblyModel}
        onAssemblyModelChange={(v) => {
          setAssemblyModel(v);
          const fixed = fixedTempFor(v);
          if (fixed !== undefined) setAssemblyTemperature(fixed);
        }}
        assemblyEffort={assemblyEffort}
        onAssemblyEffortChange={setAssemblyEffort}
        assemblyTemperature={assemblyTemperature}
        onAssemblyTemperatureChange={setAssemblyTemperature}
        onAssemble={() => setAssemblyModalOpen(true)}
        assembling={assembling}
        onDelete={async () => {
          if (!assemblyPrompt) return;
          await fetch(`/api/projects/${params.id}/prompts/${assemblyPrompt.id}`, {
            method: "DELETE",
          });
          fetchPrompts();
        }}
      />

      {/* Assembly Modal */}
      <Dialog open={assemblyModalOpen} onOpenChange={setAssemblyModalOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Assemble Chapter</DialogTitle>
            <DialogDescription>
              Select a version of each fragment for assembly.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto -mx-6 px-6 space-y-6">
            {/* Assembly prompt picker — shown when no embedded assembly prompt */}
            {!assemblyPrompt && (
              <div className="space-y-2">
                <h4 className="text-sm font-medium flex items-center gap-1.5">
                  <Puzzle className="h-3.5 w-3.5 text-muted-foreground" />
                  Assembly Prompt
                </h4>
                {assemblyPromptList.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Loading assembly prompts…</p>
                ) : (
                  <select
                    value={assemblyPromptId}
                    onChange={(e) => setAssemblyPromptId(e.target.value)}
                    className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="">Select an assembly prompt…</option>
                    {assemblyPromptList.map((ap) => (
                      <option key={ap.id} value={ap.id}>{ap.name}</option>
                    ))}
                  </select>
                )}
              </div>
            )}

            {contentPrompts.map((prompt) => {
              const versions = fragmentVersions.get(prompt.id) ?? [];
              const selectedId = selectedFragments[prompt.id];

              return (
                <div key={prompt.id} className="space-y-2">
                  <h4 className="text-sm font-medium">
                    {prompt.title}
                  </h4>

                  {versions.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      No fragments generated
                    </p>
                  ) : (
                    <div className="space-y-1.5">
                      {versions.map((v, i) => (
                        <label
                          key={v.id}
                          className={`flex items-start gap-3 p-3 rounded-md border cursor-pointer transition-colors ${
                            selectedId === v.id
                              ? "border-primary bg-primary/5"
                              : "border-border hover:bg-muted/50"
                          }`}
                        >
                          <input
                            type="radio"
                            name={`fragment-${prompt.id}`}
                            value={v.id}
                            checked={selectedId === v.id}
                            onChange={() =>
                              setSelectedFragments((prev) => ({
                                ...prev,
                                [prompt.id]: v.id,
                              }))
                            }
                            className="mt-0.5"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-0.5">
                              <span className="text-xs font-medium">
                                v{i + 1}
                              </span>
                              {v.modelUsed && (
                                <span className="text-[10px] bg-muted px-1 py-0.5 rounded">
                                  {v.modelUsed}
                                </span>
                              )}
                              {v.tokensUsed != null && (
                                <span className="text-[10px] text-muted-foreground">
                                  {v.tokensUsed.toLocaleString()} tokens
                                </span>
                              )}
                              {v.createdAt && (
                                <span className="text-[10px] text-muted-foreground">
                                  {formatDistanceToNow(new Date(v.createdAt), {
                                    addSuffix: true,
                                    locale: enUS,
                                  })}
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground line-clamp-2">
                              {v.content?.slice(0, 200)}
                              {(v.content?.length ?? 0) > 200 ? "…" : ""}
                            </p>
                          </div>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Assembly controls */}
          <div className="flex items-center justify-between pt-4 border-t">
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-muted-foreground">Model:</span>
              <Select value={assemblyModel} onValueChange={(v) => {
                setAssemblyModel(v);
                const fixed = fixedTempFor(v);
                if (fixed !== undefined) setAssemblyTemperature(fixed);
              }}>
                <SelectTrigger className="w-[140px] h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MODELS.map((m) => (
                    <SelectItem key={m.id} value={m.id} className="text-xs">
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={assemblyEffort} onValueChange={setAssemblyEffort}>
                <SelectTrigger className="w-[70px] h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="max" className="text-xs">Max</SelectItem>
                  {EFFORT_OPTIONS.map((o) => (<SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>))}
                </SelectContent>
              </Select>
              {assemblyEffort === "off" && (
                <>
                  <span className="text-[10px] text-muted-foreground">T:</span>
                  {(() => {
                    const fixed = fixedTempFor(assemblyModel);
                    return (
                      <input
                        type="number"
                        min="0"
                        max="1"
                        step="0.1"
                        value={fixed ?? assemblyTemperature}
                        disabled={fixed !== undefined}
                        onChange={(e) => {
                          const v = parseFloat(e.target.value);
                          if (!isNaN(v) && v >= 0 && v <= 1)
                            setAssemblyTemperature(v);
                        }}
                        className={`w-14 h-8 text-xs border rounded px-1.5 text-center ${
                          fixed !== undefined
                            ? "bg-muted/30 text-muted-foreground cursor-not-allowed border-muted"
                            : "bg-muted/50 border-border"
                        }`}
                        title={fixed !== undefined ? `Temperature fixed at ${fixed} for this model` : undefined}
                      />
                    );
                  })()}
                </>
              )}
            </div>
            <Button
              size="sm"
              onClick={runAssembly}
              disabled={
                assembling ||
                Object.values(selectedFragments).filter(Boolean).length === 0
              }
            >
              {assembling ? (
                <Loader2 className="h-3 w-3 animate-spin mr-1" />
              ) : (
                <Play className="h-3 w-3 mr-1" />
              )}
              Assemble
            </Button>
          </div>
        </DialogContent>
      </Dialog>

    </div>
  );
}
