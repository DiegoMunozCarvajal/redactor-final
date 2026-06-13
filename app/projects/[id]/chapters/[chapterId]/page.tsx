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
  History,
  Copy,
  Puzzle,
  MessageSquareQuote,
} from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { enUS } from "date-fns/locale";
import { MODELS_BY_STAGE } from "@/lib/ai/providers";
import { AssemblyPromptSection } from "@/components/prompts/assembly-prompt-section";
import { CritiquePromptSection } from "@/components/prompts/critique-prompt-section";
import { CorrectorSection } from "@/components/prompts/corrector-section";
import { CorrectorPromptSection } from "@/components/prompts/corrector-prompt-section";
import { VersionHistory } from "@/components/prompts/version-history";
import { PlaceholderFillSection } from "@/components/projects/placeholder-fill-section";
import type { ChapterPlaceholder } from "@/lib/db/schema";
import { getLatestGenerationError } from "@/lib/generation-errors";
import {
  getActiveGeneration,
  getActivePromptGenerationByPromptId,
} from "@/lib/generation-status";
import {
  getAssemblyVersions,
  getSelectedAssemblyVersion,
  type AssemblyMetadata,
} from "@/lib/assembly-versions";
import { runSettledWithConcurrency } from "@/lib/promise-pool";

const STALE_MS = 30 * 60 * 1000;

// Separate from MODEL_OPTIONS because this list includes a `short` label
// for compact UI display. Kept in sync with AVAILABLE_MODELS manually.
const MODELS = [
  { id: "gpt-5.5", label: "GPT 5.5", short: "GPT 5.5" },
  { id: "claude-opus-4-8", label: "Claude Opus 4.8", short: "Opus 4.8" },
  { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro", short: "DS Pro" },
];

const DEFAULT_MODEL = "deepseek-v4-pro";
const FRAGMENT_GENERATION_CONCURRENCY = 3;

// Models filtered for the assembly stage dropdown
const ASSEMBLY_MODEL_IDS = new Set(
  MODELS_BY_STAGE.assemble_small_book_chapter.map((m) => m.id),
);
const ASSEMBLY_MODELS = MODELS.filter((m) => ASSEMBLY_MODEL_IDS.has(m.id));

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
  generationMetadata: {
    type?: string;
    promptId?: string;
    promptTitle?: string;
    model?: string;
    provider?: string;
    effort?: string;
  } | null;
  assembledContent: string | null;
  assemblyMetadata: AssemblyMetadata | null;
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
  isCritique: boolean;
  isCorrector: boolean;
  title: string;
  content: string;
  userPrompt?: string | null;
}

function statusBadge(status: string) {
  switch (status) {
    case "completed":
      return <Badge className="bg-success/10 text-success border-success/20">Completed</Badge>;
    case "generating":
      return <Badge className="bg-info/10 text-info border-info/20">Generating</Badge>;
    case "assembling":
      return <Badge className="bg-info/10 text-info border-info/20">Assembling</Badge>;
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
  const [generatingAll, setGeneratingAll] = useState(false);
  const [defaultModel, setDefaultModel] = useState(DEFAULT_MODEL);
  const [promptModels, setPromptModels] = useState<Record<string, string>>({});
  const [assemblyModalOpen, setAssemblyModalOpen] = useState(false);
  const [selectedFragments, setSelectedFragments] = useState<Record<string, string>>({});
  const [assembling, setAssembling] = useState(false);
  const [selectingAssembly, setSelectingAssembly] = useState(false);
  const [assemblyPromptId, setAssemblyPromptId] = useState<string>("");
  const [assemblyPromptList, setAssemblyPromptList] = useState<{ id: string; name: string; description: string | null }[]>([]);
  const [assemblyAlgorithm, setAssemblyAlgorithm] = useState<"merge-sort" | "sequential" | "halves">("merge-sort");
  const [assemblyModel, setAssemblyModel] = useState(DEFAULT_MODEL);
  const [selectedAssemblyGenerationId, setSelectedAssemblyGenerationId] = useState<string | undefined>();
  const [selectedFragmentVersion, setSelectedFragmentVersion] = useState<Record<string, string | undefined>>({});
  const [critiquePromptId, setCritiquePromptId] = useState<string>("");
  const [critiquePromptList, setCritiquePromptList] = useState<{ id: string; name: string; description: string | null }[]>([]);
  const [selectingCritique, setSelectingCritique] = useState(false);
  const [critiquing, setCritiquing] = useState(false);
  const [critiqueModel, setCritiqueModel] = useState(DEFAULT_MODEL);
  const [critiqueModalOpen, setCritiqueModalOpen] = useState(false);
  const [selectedCritiqueGenerationId, setSelectedCritiqueGenerationId] = useState<string | undefined>();
  const [correctorPromptList, setCorrectorPromptList] = useState<{ id: string; name: string; description: string | null }[]>([]);
  const [selectingCorrector, setSelectingCorrector] = useState(false);
  const [correcting, setCorrecting] = useState(false);
  const [correctorModalOpen, setCorrectorModalOpen] = useState(false);
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

  const fetchCritiqueLibrary = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch("/api/critique-prompts", { signal });
      if (signal?.aborted) return;
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) setCritiquePromptList(data);
      }
    } catch { /* supplementary */ }
  }, []);

  const fetchCorrectorLibrary = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch("/api/corrector-prompts", { signal });
      if (signal?.aborted) return;
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) setCorrectorPromptList(data);
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
      fetchCritiqueLibrary(controller.signal),
      fetchCorrectorLibrary(controller.signal),
    ]);
    return () => controller.abort();
  }, [fetchChapter, fetchPrompts, fetchPlaceholders, fetchAssemblyLibrary, fetchCritiqueLibrary, fetchCorrectorLibrary]);

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
            effort: "max",
          }),
        },
      );
      if (res.ok) {
        fetchChapter();
        fetchPlaceholders();
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
    if (contentPrompts.length === 0) return;

    setGeneratingAll(true);
    setGeneratingPrompts((prev) => {
      const next = new Set(prev);
      for (const prompt of contentPrompts) next.add(prompt.id);
      return next;
    });

    try {
      const results = await runSettledWithConcurrency(
        contentPrompts,
        FRAGMENT_GENERATION_CONCURRENCY,
        async (prompt) => {
          try {
            const res = await fetch(
              `/api/projects/${params.id}/prompts/${prompt.id}/generate`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  model: defaultModel,
                  effort: "max",
                }),
              },
            );

            if (!res.ok) {
              const err = await res.json().catch(() => ({}));
              throw new Error(err.error ?? `Error generating "${prompt.title}"`);
            }

            return res.json();
          } finally {
            setGeneratingPrompts((prev) => {
              const next = new Set(prev);
              next.delete(prompt.id);
              return next;
            });
            fetchChapter();
            fetchPlaceholders();
          }
        },
      );

      const failed = results.filter((result) => result.status === "rejected");
      fetchChapter();
      fetchPlaceholders();
      if (failed.length === 0) {
        toast.success(`${contentPrompts.length} fragments generated`);
      } else {
        toast.error(`${failed.length} fragment${failed.length === 1 ? "" : "s"} failed`);
      }
    } catch {
      toast.error("Network error");
    } finally {
      setGeneratingAll(false);
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
    setAssemblyModalOpen(false);
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
            effort: "max",
            assemblyAlgorithm,
            ...(assemblyPromptId ? { assemblyPromptId } : {}),
          }),
        },
      );
      if (res.ok) {
        fetchChapter();
        fetchPlaceholders();
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
      if (res.ok) {
        fetchPlaceholders();
      } else {
        toast.error(`Error saving ${field}`);
      }
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
      fetchPlaceholders();
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
      fetchPlaceholders();
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
    const hasInFlightGeneration = Boolean(
      getActiveGeneration(data.generations, Date.now(), STALE_MS),
    );
    if (!hasInFlightGeneration && !assembling) return;

    const interval = setInterval(() => {
      if (fetchingRef.current) return;
      fetchingRef.current = true;
      fetchChapter().finally(() => { fetchingRef.current = false; });
    }, 3000);
    return () => clearInterval(interval);
  }, [assembling, data, fetchChapter]);

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
  const activeGen = getActiveGeneration(generations, Date.now(), STALE_MS);
  const isGeneratingFragments = activeGen?.status === "generating" && activeGen?.generationMetadata?.type !== "critique";
  const isCritiquing = critiquing || (activeGen?.status === "generating" && activeGen?.generationMetadata?.type === "critique");
  const isAssemblingChapter = assembling || activeGen?.status === "assembling";
  const activePromptGenerationByPromptId = getActivePromptGenerationByPromptId(
    generations,
    Date.now(),
    STALE_MS,
  );

  // Build a map of prompt ID → fragment for the active generation
  const promptFragmentMap = new Map<string, FragmentData>();
  if (isGeneratingFragments && activeGen) {
    for (const f of activeGen.fragments) {
      if (f.projectPromptId) {
        promptFragmentMap.set(f.projectPromptId, f);
      }
    }
  }

  // Build fragment versions across ALL generations grouped by prompt ID.
  // Relies on generations being sorted newest-first (guaranteed by the API:
  // ORDER BY created_at DESC) and fragments within each generation being
  // sorted by position (ORDER BY position ASC). The first fragment encountered
  // per promptId is from the newest generation that has it.
  const fragmentVersions = new Map<string, FragmentData[]>();
  const latestFragmentByPrompt = new Map<string, FragmentData>();
  for (const gen of generations) {
    for (const f of gen.fragments) {
      if (!f.projectPromptId || !f.content) continue;
      const list = fragmentVersions.get(f.projectPromptId) ?? [];
      list.push(f);
      fragmentVersions.set(f.projectPromptId, list);
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
        fetchPlaceholders();
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

  async function handleSelectCritiquePrompt(libraryId: string) {
    setSelectingCritique(true);
    try {
      const res = await fetch(`/api/critique-prompts/${libraryId}`);
      if (!res.ok) {
        toast.error("Failed to load critique prompt");
        return;
      }
      const cp = await res.json();
      const createRes = await fetch(`/api/projects/${params.id}/prompts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chapterId: params.chapterId,
          title: cp.name,
          content: cp.content,
          userPrompt: cp.userPrompt ?? null,
          isCritique: true,
        }),
      });
      if (createRes.ok) {
        toast.success(`Critique prompt "${cp.name}" added`);
        fetchPrompts();
        fetchPlaceholders();
      } else {
        const err = await createRes.json().catch(() => ({}));
        toast.error(err.error ?? "Failed to add critique prompt");
      }
    } catch {
      toast.error("Network error");
    } finally {
      setSelectingCritique(false);
    }
  }

  async function handleSelectCorrectorPrompt(libraryId: string) {
    setSelectingCorrector(true);
    try {
      const res = await fetch(`/api/corrector-prompts/${libraryId}`);
      if (!res.ok) {
        toast.error("Failed to load corrector prompt");
        return;
      }
      const cp = await res.json();
      const createRes = await fetch(`/api/projects/${params.id}/prompts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chapterId: params.chapterId,
          title: cp.name,
          content: cp.content,
          userPrompt: cp.userPrompt ?? null,
          isCorrector: true,
        }),
      });
      if (createRes.ok) {
        toast.success(`Corrector prompt "${cp.name}" added`);
        fetchPrompts();
        fetchPlaceholders();
      } else {
        const err = await createRes.json().catch(() => ({}));
        toast.error(err.error ?? "Failed to add corrector prompt");
      }
    } catch {
      toast.error("Network error");
    } finally {
      setSelectingCorrector(false);
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

  function openCritiqueModal() {
    // Fetch critique prompts for the picker if not loaded
    if (critiquePromptList.length === 0) {
      fetch("/api/critique-prompts")
        .then((r) => r.json())
        .then((data) => {
          if (Array.isArray(data)) setCritiquePromptList(data);
        })
        .catch(() => {});
    }
    setCritiqueModalOpen(true);
  }

  async function runCritique() {
    if (!critiquePromptId) {
      toast.error("Select a critique prompt");
      return;
    }
    setCritiquing(true);
    try {
      const res = await fetch(
        `/api/projects/${params.id}/chapters/${params.chapterId}/critique`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            critiquePromptId,
            model: critiqueModel,
          }),
        },
      );
      if (res.ok) {
        setCritiqueModalOpen(false);
        await fetchChapter();
        await fetchPlaceholders();
        toast.success("Critique completed");
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error ?? "Critique error");
      }
    } catch {
      toast.error("Network error");
    } finally {
      setCritiquing(false);
    }
  }

  const contentPrompts = prompts.filter((p) => !p.isAssembly && !p.isCritique && !p.isCorrector);
  const assemblyPrompt = prompts.find((p) => p.isAssembly);
  const critiquePrompt = prompts.find((p) => p.isCritique);
  const correctorPrompt = prompts.find((p) => p.isCorrector);
  const totalContentDone = contentPrompts.filter(
    (p) => promptFragmentMap.has(p.id),
  ).length;

  const totalTokens = generations.reduce((sum, g) => {
    return sum + g.fragments.reduce((s, f) => s + (f.tokensUsed ?? 0), 0);
  }, 0);
  // Exclude critique generations from assembly versions.
  // Generations with null generationMetadata (pre-metadata records) pass through
  // safely: getAssemblyVersions filters on assembledContent, so they're excluded anyway.
  const assemblyGenerations = generations.filter(
    (g) => g.generationMetadata?.type !== "critique" && g.generationMetadata?.type !== "correction",
  );
  const assemblyVersions = getAssemblyVersions(assemblyGenerations);
  const hasAssembly = assemblyVersions.length > 0;
  const selectedAssemblyVersion = getSelectedAssemblyVersion(
    assemblyGenerations,
    selectedAssemblyGenerationId,
  );
  const selectedAssemblyIndex = selectedAssemblyVersion
    ? assemblyVersions.findIndex((gen) => gen.id === selectedAssemblyVersion.id)
    : -1;
  const selectedAssemblyVersionNumber = selectedAssemblyIndex >= 0
    ? assemblyVersions.length - selectedAssemblyIndex
    : 0;

  // Critique generations: generations with generationMetadata.type === "critique"
  const critiqueGenerations = generations.filter(
    (g) => g.generationMetadata?.type === "critique" && g.status === "completed" && g.assembledContent,
  );
  const selectedCritique = selectedCritiqueGenerationId
    ? critiqueGenerations.find((g) => g.id === selectedCritiqueGenerationId) ?? critiqueGenerations[0]
    : critiqueGenerations[0] ?? null;

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
              {" "}· {statusBadge(activeGen.status)}{" "}
              {isGeneratingFragments ? (
                <span className="text-xs">
                  ({totalContentDone}/{contentPrompts.length} prompts)
                </span>
              ) : null}
            </>
          )}
        </div>
      </div>

      {isAssemblingChapter && (
        <Card className="mb-6 border-info/30 bg-info/5">
          <CardContent className="pt-4">
            <div className="flex items-start gap-3" role="status" aria-live="polite">
              <Loader2 className="h-4 w-4 animate-spin text-info mt-0.5" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-info">Assembling chapter</p>
                <p className="text-xs text-muted-foreground">
                  Assembly is running in the background. Results will appear below when complete.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {isCritiquing && (
        <Card className="mb-6 border-info/30 bg-info/5">
          <CardContent className="pt-4">
            <div className="flex items-start gap-3" role="status" aria-live="polite">
              <Loader2 className="h-4 w-4 animate-spin text-info mt-0.5" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-info">Running critique</p>
                <p className="text-xs text-muted-foreground">
                  Critique is running in the background. Results will appear below when complete.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Generation error — only show latest generation failure */}
      {(() => {
        const generationError = getLatestGenerationError(generations);
        if (!generationError) return null;
        return (
          <Card className="mb-6 border-destructive/30">
            <CardContent className="pt-4">
              <p className="text-sm text-destructive bg-destructive/5 rounded-md p-3">
                {generationError}
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
        onFillComplete={fetchPlaceholders}
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
          {contentPrompts.length > 0 && (
            <Button
              size="sm"
              onClick={runAllPrompts}
              disabled={generatingAll || generatingPrompts.size > 0}
            >
              {generatingAll ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : generatingPrompts.size > 0 ? (
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
            const activePromptGeneration = activePromptGenerationByPromptId.get(prompt.id);
            const isGenerating = generatingPrompts.has(prompt.id) || Boolean(activePromptGeneration);
            const isDone = !!fragment;

            return (
              <Card
                key={prompt.id}
                className={`${
                  isGenerating
                    ? "border-info/30 bg-info/5"
                    : isDone
                      ? "border-success/20"
                      : ""
                } cursor-pointer hover:border-primary/30 transition-colors`}
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
                        <Badge className="bg-info/10 text-info border-info/20 text-[10px]">
                          Generating
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
                        {isGenerating ? "Generating" : isDone ? "Regenerate" : "Generate"}
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

                {isGenerating && (
                  <CardContent className="border-t pt-3">
                    <div className="flex items-start gap-2 rounded-md bg-info/5 p-3" role="status" aria-live="polite">
                      <Loader2 className="h-4 w-4 animate-spin text-info mt-0.5" />
                      <div>
                        <p className="text-sm font-medium text-info">Generating fragment</p>
                        <p className="text-xs text-muted-foreground">
                          {activePromptGeneration?.generationMetadata?.model
                            ? `Model: ${activePromptGeneration.generationMetadata.model}`
                            : "Request is running in the background."}
                        </p>
                      </div>
                    </div>
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
      {assemblyVersions.length > 0 && selectedAssemblyVersion && (
        <div className="space-y-3 mb-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-medium text-muted-foreground">
              Assembly Results
            </h2>
            {assemblyVersions.length > 1 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <History className="h-3.5 w-3.5 text-muted-foreground" />
                {assemblyVersions.map((gen, index) => {
                  const versionNumber = assemblyVersions.length - index;
                  const selected = gen.id === selectedAssemblyVersion.id;
                  return (
                    <button
                      key={gen.id}
                      type="button"
                      onClick={() => setSelectedAssemblyGenerationId(gen.id)}
                      className={`h-7 rounded-md px-2 text-[10px] transition-colors ${
                        selected
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground hover:bg-muted/70"
                      }`}
                    >
                      v{versionNumber}{index === 0 ? " Latest" : ""}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <Card className="border-success/20">
            <CardContent className="pt-4">
              <div className="flex flex-wrap items-center gap-2 mb-3 text-[10px] text-muted-foreground">
                {statusBadge(selectedAssemblyVersion.status)}
                {selectedAssemblyVersionNumber > 0 && (
                  <Badge variant="secondary">v{selectedAssemblyVersionNumber}</Badge>
                )}
                {selectedAssemblyVersion.completedAt && (
                  <span>
                    {new Date(selectedAssemblyVersion.completedAt).toLocaleString()}
                  </span>
                )}
                <div className="flex-1" />
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  onClick={() => {
                    navigator.clipboard.writeText(selectedAssemblyVersion.assembledContent ?? "");
                    toast.success("Assembly copied");
                  }}
                >
                  <Copy className="h-3 w-3 mr-1" /> Copy
                </Button>
              </div>

              <dl className="grid gap-2 rounded-md bg-muted/40 p-3 text-xs sm:grid-cols-2 lg:grid-cols-4 mb-4">
                <div>
                  <dt className="text-muted-foreground">Algorithm</dt>
                  <dd className="font-medium">
                    {selectedAssemblyVersion.assemblyMetadata?.algorithm ?? "Unknown"}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Assembly Prompt</dt>
                  <dd className="font-medium">
                    {selectedAssemblyVersion.assemblyMetadata?.promptTitle ?? "Unknown"}
                    {selectedAssemblyVersion.assemblyMetadata?.promptSource ? (
                      <span className="ml-1 text-muted-foreground">
                        ({selectedAssemblyVersion.assemblyMetadata.promptSource})
                      </span>
                    ) : null}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Model</dt>
                  <dd className="font-medium">
                    {selectedAssemblyVersion.assemblyMetadata?.model ?? "Unknown"}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Fragments</dt>
                  <dd className="font-medium">
                    {selectedAssemblyVersion.assemblyMetadata?.fragmentCount ?? "Unknown"}
                  </dd>
                </div>
              </dl>

              <div className="prose prose-sm dark:prose-invert max-w-none text-sm">
                <ReactMarkdown rehypePlugins={[rehypeSanitize]}>
                  {selectedAssemblyVersion.assembledContent!}
                </ReactMarkdown>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Critique Results */}
      {selectedCritique && (
        <div className="space-y-3 mb-8">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-medium text-muted-foreground">
              Critique Results
            </h2>
            {critiqueGenerations.length > 1 && (
              <div className="flex items-center gap-1.5">
                <History className="h-3.5 w-3.5 text-muted-foreground" />
                {critiqueGenerations.map((gen, index) => {
                  const versionNumber = critiqueGenerations.length - index;
                  return (
                    <button
                      key={gen.id}
                      type="button"
                      onClick={() => setSelectedCritiqueGenerationId(gen.id)}
                      className={`h-7 rounded-md px-2 text-[10px] transition-colors ${
                        gen.id === selectedCritique.id
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground hover:bg-muted/70"
                      }`}
                    >
                      v{versionNumber}{index === 0 ? " Latest" : ""}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <Card className="border-info/20">
            <CardContent className="pt-4">
              <div className="flex flex-wrap items-center gap-2 mb-3 text-[10px] text-muted-foreground">
                {statusBadge(selectedCritique.status)}
                {selectedCritique.generationMetadata?.promptTitle && (
                  <span className="bg-muted px-1.5 py-0.5 rounded">
                    {selectedCritique.generationMetadata.promptTitle}
                  </span>
                )}
                {selectedCritique.completedAt && (
                  <span>
                    {new Date(selectedCritique.completedAt).toLocaleString()}
                  </span>
                )}
                <div className="flex-1" />
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  onClick={() => {
                    navigator.clipboard.writeText(selectedCritique.assembledContent ?? "");
                    toast.success("Critique copied");
                  }}
                >
                  <Copy className="h-3 w-3 mr-1" /> Copy
                </Button>
              </div>

              <dl className="grid gap-2 rounded-md bg-muted/40 p-3 text-xs sm:grid-cols-2 lg:grid-cols-3 mb-4">
                <div>
                  <dt className="text-muted-foreground">Critique Prompt</dt>
                  <dd className="font-medium">
                    {selectedCritique.generationMetadata?.promptTitle ?? "Unknown"}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Model</dt>
                  <dd className="font-medium">
                    {selectedCritique.generationMetadata?.model ?? "Unknown"}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Type</dt>
                  <dd className="font-medium">Critique</dd>
                </div>
              </dl>

              <div className="text-sm">
                <pre className="whitespace-pre-wrap break-words font-mono bg-muted/30 p-3 rounded-md max-h-[600px] overflow-y-auto">
                  {selectedCritique.assembledContent!}
                </pre>
              </div>
            </CardContent>
          </Card>
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
                disabled={isAssemblingChapter}
              >
                {isAssemblingChapter ? (
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                ) : (
                  <Play className="h-3 w-3 mr-1" />
                )}
                {isAssemblingChapter ? "Assembling" : "Assemble Chapter"}
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      <AssemblyPromptSection
        prompt={assemblyPrompt}
        assemblyLibrary={assemblyPromptList}
        onSelectFromLibrary={handleSelectAssemblyPrompt}
        selectingFromLibrary={selectingAssembly}
        onAssemble={openAssemblyModal}
        assembling={isAssemblingChapter}
        onDelete={async () => {
          if (!assemblyPrompt) return;
          await fetch(`/api/projects/${params.id}/prompts/${assemblyPrompt.id}`, {
            method: "DELETE",
          });
          fetchPrompts();
          fetchPlaceholders();
        }}
      />

      <CritiquePromptSection
        prompt={critiquePrompt}
        critiqueLibrary={critiquePromptList}
        onSelectFromLibrary={handleSelectCritiquePrompt}
        selectingFromLibrary={selectingCritique}
        onCritique={() => setCritiqueModalOpen(true)}
        critiquing={critiquing}
        onDelete={async () => {
          if (!critiquePrompt) return;
          await fetch(`/api/projects/${params.id}/prompts/${critiquePrompt.id}`, {
            method: "DELETE",
          });
          fetchPrompts();
          fetchPlaceholders();
        }}
      />

      <CorrectorPromptSection
        prompt={correctorPrompt}
        correctorLibrary={correctorPromptList}
        onSelectFromLibrary={handleSelectCorrectorPrompt}
        selectingFromLibrary={selectingCorrector}
        onCorrect={() => setCorrectorModalOpen(true)}
        correcting={correcting}
        onDelete={async () => {
          if (!correctorPrompt) return;
          await fetch(`/api/projects/${params.id}/prompts/${correctorPrompt.id}`, {
            method: "DELETE",
          });
          fetchPrompts();
          fetchPlaceholders();
        }}
      />

      {/* Assembly Modal */}
      <Dialog open={assemblyModalOpen} onOpenChange={setAssemblyModalOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Assemble Chapter</DialogTitle>
            <DialogDescription>
              {isAssemblingChapter
                ? "Assembly is running in the background."
                : "Select a version of each fragment for assembly."}
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto -mx-6 px-6 space-y-6">
            {isAssemblingChapter && (
              <div className="rounded-md border border-info/30 bg-info/5 p-3" role="status" aria-live="polite">
                <div className="flex items-start gap-2">
                  <Loader2 className="h-4 w-4 animate-spin text-info mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-info">Assembling chapter</p>
                    <p className="text-xs text-muted-foreground">
                      Keep this open or close it; polling will refresh results automatically.
                    </p>
                  </div>
                </div>
              </div>
            )}

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
              <Select value={assemblyModel} onValueChange={setAssemblyModel}>
                <SelectTrigger className="w-[140px] h-7 text-[10px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ASSEMBLY_MODELS.map((m) => (
                    <SelectItem key={m.id} value={m.id} className="text-[10px]">
                      {m.short}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={assemblyAlgorithm} onValueChange={(v) => setAssemblyAlgorithm(v as "merge-sort" | "sequential" | "halves")}>
                <SelectTrigger className="w-[110px] h-7 text-[10px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="merge-sort" className="text-[10px]">Merge-Sort</SelectItem>
                  <SelectItem value="halves" className="text-[10px]">Halves</SelectItem>
                  <SelectItem value="sequential" className="text-[10px]">Sequential</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button
              size="sm"
              onClick={runAssembly}
              disabled={
                isAssemblingChapter ||
                Object.values(selectedFragments).filter(Boolean).length === 0
              }
            >
              {isAssemblingChapter ? (
                <Loader2 className="h-3 w-3 animate-spin mr-1" />
              ) : (
                <Play className="h-3 w-3 mr-1" />
              )}
              {isAssemblingChapter ? "Assembling" : "Assemble"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Corrector Section */}
      <CorrectorSection
        projectId={params.id}
        chapterId={params.chapterId}
        generations={generations}
        hasAssembly={hasAssembly}
        projectCorrectorPromptId={correctorPrompt?.id}
        projectCorrectorPromptContent={correctorPrompt?.content}
        projectCorrectorPromptUserPrompt={correctorPrompt?.userPrompt}
        modalOpen={correctorModalOpen}
        onOpenChange={setCorrectorModalOpen}
        onGenerationCreated={() => {
          fetchChapter();
          fetchPlaceholders();
        }}
      />

      {/* Critique Modal */}
      <Dialog open={critiqueModalOpen} onOpenChange={setCritiqueModalOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Critique Chapter</DialogTitle>
            <DialogDescription>
              {critiquing
                ? "Critique is running in the background."
                : "Select a critique prompt to analyze the assembled chapter."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {critiquing && (
              <div className="rounded-md border border-info/30 bg-info/5 p-3" role="status" aria-live="polite">
                <div className="flex items-start gap-2">
                  <Loader2 className="h-4 w-4 animate-spin text-info mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-info">Running critique</p>
                    <p className="text-xs text-muted-foreground">
                      Keep this open or close it; polling will refresh results automatically.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {!hasAssembly && (
              <div className="rounded-md border border-warning/30 bg-warning/5 p-3">
                <p className="text-xs text-warning">
                  No assembled content found. Assemble the chapter first before running a critique.
                </p>
              </div>
            )}

            {/* Critique prompt picker */}
            <div className="space-y-2">
              <h4 className="text-sm font-medium flex items-center gap-1.5">
                <MessageSquareQuote className="h-3.5 w-3.5 text-muted-foreground" />
                Critique Prompt
              </h4>
              {critiquePromptList.length === 0 ? (
                <p className="text-xs text-muted-foreground">No critique prompts available. Create one in the Critique Prompts section.</p>
              ) : (
                <select
                  value={critiquePromptId}
                  onChange={(e) => setCritiquePromptId(e.target.value)}
                  className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">Select a critique prompt…</option>
                  {critiquePromptList.map((cp) => (
                    <option key={cp.id} value={cp.id}>{cp.name}</option>
                  ))}
                </select>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between pt-4 border-t">
            <Select value={critiqueModel} onValueChange={setCritiqueModel}>
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
            <Button
              size="sm"
              onClick={runCritique}
              disabled={critiquing || !critiquePromptId || !hasAssembly}
              title={!hasAssembly ? "Assemble the chapter first before running a critique" : undefined}
            >
              {critiquing ? (
                <Loader2 className="h-3 w-3 animate-spin mr-1" />
              ) : (
                <MessageSquareQuote className="h-3 w-3 mr-1" />
              )}
              {critiquing ? "Critiquing" : "Run Critique"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

    </div>
  );
}
