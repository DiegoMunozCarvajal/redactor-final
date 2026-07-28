"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
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
} from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { enUS } from "date-fns/locale";
import { MODELS_BY_STAGE } from "@/lib/ai/providers";
import {
  AssemblyPromptSection,
  loadAssemblyPipelineData,
  type AssemblyPipelineData,
} from "@/components/prompts/assembly-prompt-section";
import { CritiquePromptSection } from "@/components/prompts/critique-prompt-section";
import { CorrectorSection } from "@/components/prompts/corrector-section";
import { CorrectorPromptSection } from "@/components/prompts/corrector-prompt-section";
import { VersionHistory } from "@/components/prompts/version-history";
import { PlaceholderFillSection } from "@/components/projects/placeholder-fill-section";
import type { EnrichedPlaceholder } from "@/components/projects/placeholder-fill-section";
import { DiffModal } from "@/components/projects/diff-modal";
import { EditorialVersionBadge } from "@/components/projects/editorial-version-badge";
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
import { assemblyPlanV1Schema } from "@/lib/assembly/plan-schema";
import { runSettledWithConcurrency } from "@/lib/promise-pool";
import {
  loadReviewPromptRegistry,
  setReviewPromptBinding,
  clearReviewPromptBinding,
  type ReviewPromptRegistryData,
  type ReviewPromptKind,
} from "@/components/prompts/review-prompt-registry";
import { buildCritiqueRequestBody } from "@/lib/review/request-payloads";

const STALE_MS = 30 * 60 * 1000;

// Separate from MODEL_OPTIONS because this list includes a `short` label
// for compact UI display. Kept in sync with AVAILABLE_MODELS manually.
const MODELS = [
  { id: "gpt-5.5", label: "GPT 5.5", short: "GPT 5.5" },
  { id: "claude-opus-4-8", label: "Claude Opus 4.8", short: "Opus 4.8" },
  { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro", short: "DS Pro" },
];

const DEFAULT_MODEL = "deepseek-v4-pro";
// Project rate limiting permits one active generation at a time.
const FRAGMENT_GENERATION_CONCURRENCY = 1;

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
    editorialBriefId?: string;
    editorialBriefVersion?: number;
    editorialBriefHash?: string;
    critiquePromptRevisionId?: string;
  } | null;
  assembledContent: string | null;
  assemblyMetadata: AssemblyMetadata | null;
  assemblyPlan?: Record<string, unknown> | null;
  planningMetadata?: Record<string, unknown> | null;
  plannerPromptRevisionId?: string | null;
  assemblyPromptRevisionId?: string | null;
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
  activeBrief: { id: string; version: number; hash: string } | null;
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
    case "planning":
      return <Badge className="bg-info/10 text-info border-info/20">Planning</Badge>;
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

interface ExecutionDialogData {
  stage?: string;
  status?: string;
  model?: string;
  provider?: string;
  error?: string;
  createdAt?: string;
  completedAt?: string;
  messages?: Array<{ role: string; content: string }>;
  outputContract?: string | null;
  technicalPolicies?: string[];
  dataManifest?: Record<string, unknown>;
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
  revision?: { definitionName?: string; versionLabel?: string };
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
  const [assemblyModel, setAssemblyModel] = useState(DEFAULT_MODEL);
  const [plannerRevisionId, setPlannerRevisionId] = useState<string | undefined>();
  const [assemblyRevisionId, setAssemblyRevisionId] = useState<string | undefined>();
  const [assemblyPipeline, setAssemblyPipeline] = useState<AssemblyPipelineData | null>(null);
  const [revisionLoadError, setRevisionLoadError] = useState<string | null>(null);
  const [revisionsLoading, setRevisionsLoading] = useState(true);
  const [selectedAssemblyGenerationId, setSelectedAssemblyGenerationId] = useState<string | undefined>();
  const [diffModalOpen, setDiffModalOpen] = useState(false);
  const [selectedFragmentVersion, setSelectedFragmentVersion] = useState<Record<string, string | undefined>>({});
  const [critiquing, setCritiquing] = useState(false);
  const [critiqueModel, setCritiqueModel] = useState(DEFAULT_MODEL);
  const [selectedCritiqueGenerationId, setSelectedCritiqueGenerationId] = useState<string | undefined>();
  const [correctorModel, setCorrectorModel] = useState(DEFAULT_MODEL);
  const [correcting, setCorrecting] = useState(false);
  const [correctionTrigger, setCorrectionTrigger] = useState(0);
  const [reviewRegistry, setReviewRegistry] = useState<ReviewPromptRegistryData | null>(null);
  const [reviewRegistryLoading, setReviewRegistryLoading] = useState(true);
  const [reviewRegistryError, setReviewRegistryError] = useState<string | null>(null);
  const [savingReviewKind, setSavingReviewKind] = useState<ReviewPromptKind | null>(null);
  const fetchingRef = useRef(false);
  const pollErrorCount = useRef(0);
  const [placeholders, setPlaceholders] = useState<EnrichedPlaceholder[]>([]);
  const [currentPromptsHash, setCurrentPromptsHash] = useState<string | undefined>();
  const [editingPromptId, setEditingPromptId] = useState<string | null>(null);
  const [addingPrompt, setAddingPrompt] = useState(false);
  const [newPrompt, setNewPrompt] = useState({
    title: "",
    content: "",
  });
  const [executionDialogOpen, setExecutionDialogOpen] = useState(false);
  const [executionDialogData, setExecutionDialogData] = useState<ExecutionDialogData | null>(null);
  const [executionDialogLoading, setExecutionDialogLoading] = useState(false);

  async function openExecutionDialog(executionId: string) {
    setExecutionDialogOpen(true);
    setExecutionDialogLoading(true);
    setExecutionDialogData(null);
    try {
      const res = await fetch(`/api/prompt-executions/${executionId}`);
      if (res.ok) {
        setExecutionDialogData(await res.json());
      } else {
        setExecutionDialogData({ error: `Failed to load (${res.status})` });
      }
    } catch {
      setExecutionDialogData({ error: "Network error" });
    } finally {
      setExecutionDialogLoading(false);
    }
  }

  const [promptFormData, setPromptFormData] = useState<Record<string, {
    content: string;
  }>>({});
  const [showPromptVersions, setShowPromptVersions] = useState<Record<string, boolean>>({});
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

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
      // Reset selected versions so the latest is shown by default
      setSelectedAssemblyGenerationId(undefined);
      setSelectedCritiqueGenerationId(undefined);
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
        const data = await res.json();
        setPlaceholders(data.placeholders ?? data);
        setCurrentPromptsHash(data.currentPromptsHash);
      }
    } catch { /* supplementary */ }
  }, [params.id, params.chapterId]);

  const refreshAssemblyPipeline = useCallback(async () => {
    setRevisionsLoading(true);
    setRevisionLoadError(null);
    try {
      setAssemblyPipeline(await loadAssemblyPipelineData(params.id));
    } catch (err) {
      setAssemblyPipeline(null);
      setRevisionLoadError(
        err instanceof Error ? err.message : "Could not load assembly prompt registry",
      );
    } finally {
      setRevisionsLoading(false);
    }
  }, [params.id]);

  const refreshReviewRegistry = useCallback(async () => {
    setReviewRegistryLoading(true);
    setReviewRegistryError(null);
    try {
      setReviewRegistry(await loadReviewPromptRegistry(params.id));
    } catch (err) {
      setReviewRegistry(null);
      setReviewRegistryError(err instanceof Error ? err.message : "Failed to load review prompts");
    } finally {
      setReviewRegistryLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    void refreshReviewRegistry();
  }, [refreshReviewRegistry]);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      fetchChapter(controller.signal),
      fetchPrompts(controller.signal),
      fetchPlaceholders(controller.signal),
    ]);
    return () => controller.abort();
  }, [fetchChapter, fetchPrompts, fetchPlaceholders]);

  useEffect(() => {
    void refreshAssemblyPipeline();
  }, [refreshAssemblyPipeline]);

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
            ...(plannerRevisionId ? { plannerRevisionId } : {}),
            ...(assemblyRevisionId ? { assemblyRevisionId } : {}),
          }),
        },
      );
      if (res.ok) {
        fetchChapter();
        fetchPlaceholders();
        toast.success("Assembly started");
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
    setDeleteTarget(promptId);
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    const id = deleteTarget;
    setDeleteTarget(null);
    const res = await fetch(`/api/projects/${params.id}/prompts/${id}`, {
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

  async function saveDefinition(name: string, definition: string | null) {
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
        const data = await res.json();
        setPlaceholders(data.placeholders ?? data);
        if (data.currentPromptsHash) setCurrentPromptsHash(data.currentPromptsHash);
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

  // Initialize prompt form data when prompts load.  Only update state
  // when new prompt IDs appear — avoids re-rendering all prompt cards on
  // every poll cycle when nothing actually changed.
  useEffect(() => {
    setPromptFormData(prev => {
      let hasNew = false;
      const next = { ...prev };
      for (const p of prompts) {
        if (!next[p.id]) {
          hasNew = true;
          next[p.id] = { content: p.content };
        }
      }
      return hasNew ? next : prev;
    });
  }, [prompts]);

  // Poll if any generation is in progress (skip stale generations > 30 min old).
  // Uses a ref for the polling condition so the interval isn't recreated every
  // poll cycle when `data` (a new object each fetch) changes.
  const shouldPollRef = useRef(false);
  shouldPollRef.current = Boolean(
    getActiveGeneration(data?.generations ?? [], Date.now(), STALE_MS),
  ) || assembling;

  useEffect(() => {
    if (!shouldPollRef.current) return;

    const interval = setInterval(() => {
      if (fetchingRef.current) return;
      fetchingRef.current = true;
      fetchChapter().finally(() => { fetchingRef.current = false; });
    }, 3000);
    return () => clearInterval(interval);
  }, [assembling, fetchChapter]);

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
    setAssemblyModalOpen(true);
  }

  async function changeReviewPrompt(kind: ReviewPromptKind, value: string) {
    setSavingReviewKind(kind);
    try {
      if (value === "__global_default__") {
        await clearReviewPromptBinding(params.id, kind);
      } else {
        await setReviewPromptBinding(params.id, kind, value);
      }
      await refreshReviewRegistry();
      toast.success(`${kind === "critique" ? "Critique" : "Corrector"} prompt updated for project`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Prompt update failed");
    } finally {
      setSavingReviewKind(null);
    }
  }

  async function runCritique() {
    const critiquePrompt = reviewRegistry?.critique.effective;
    if (!critiquePrompt) {
      toast.error("No critique prompt configured");
      return;
    }
    if (!hasAssembly) {
      toast.error("Assemble the chapter first before running a critique");
      return;
    }
    setCritiquing(true);
    try {
      const res = await fetch(
        `/api/projects/${params.id}/chapters/${params.chapterId}/critique`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(buildCritiqueRequestBody(critiquePrompt.id, critiqueModel)),
        },
      );
      if (res.ok) {
        await fetchChapter();
        await fetchPlaceholders();
        toast.success("Critique started");
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
  const totalContentDone = contentPrompts.filter(
    (p) => promptFragmentMap.has(p.id),
  ).length;
  const plannerRevisions = assemblyPipeline?.plannerRevisions ?? [];
  const assemblyRevisions = assemblyPipeline?.assemblyRevisions ?? [];
  const displayedPlanner = plannerRevisionId
    ? (() => {
        const revision = plannerRevisions.find((item) => item.id === plannerRevisionId);
        return revision ? { ...revision, source: "run-override" as const } : null;
      })()
    : (assemblyPipeline?.planner ?? null);
  const displayedAssembler = assemblyRevisionId
    ? (() => {
        const revision = assemblyRevisions.find((item) => item.id === assemblyRevisionId);
        return revision ? { ...revision, source: "run-override" as const } : null;
      })()
    : (assemblyPipeline?.assembler ?? null);
  const hasSelectableFragments = fragmentVersions.size > 0;

  const totalTokens = generations.reduce((sum, g) => {
    return sum + g.fragments.reduce((s, f) => s + (f.tokensUsed ?? 0), 0);
  }, 0);
  // Include original assemblies and corrections in assembly versions.
  // Corrections are valid content to critique/re-correct — show them here.
  // Only exclude critique outputs (type === "critique") since those are analyses,
  // not chapter content.
  const assemblyGenerations = generations.filter(
    (g) => g.generationMetadata?.type !== "critique",
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

  // Find the original text that was corrected.
  // assemblyVersions is sorted by completedAt desc (newest first).
  // The original is the immediate predecessor of the correction.
  const correctionOriginalText =
    selectedAssemblyVersion?.generationMetadata?.type === "correction"
      ? (() => {
          const idx = assemblyVersions.findIndex(
            (g) => g.id === selectedAssemblyVersion.id,
          );
          if (idx < 0) return null;
          const original = assemblyVersions[idx + 1];
          return original?.assembledContent ?? null;
        })()
      : null;

  // Critique generations: generations with generationMetadata.type === "critique"
  const critiqueGenerations = generations.filter(
    (g) => g.generationMetadata?.type === "critique" && g.status === "completed" && g.assembledContent,
  );
  const selectedCritique = selectedCritiqueGenerationId
    ? critiqueGenerations.find((g) => g.id === selectedCritiqueGenerationId) ?? critiqueGenerations[0]
    : critiqueGenerations[0] ?? null;

  // Block critique button when latest content already critiqued with same prompt
  const latestContentGen = assemblyGenerations[0];
  const critiqueBlocked = (() => {
    if (!latestContentGen?.completedAt || !reviewRegistry?.critique.effective) return false;
    const latestContentDate = new Date(latestContentGen.completedAt).getTime();
    const currentRevisionId = reviewRegistry.critique.effective.id;
    return critiqueGenerations.some((g) => {
      if (!g.completedAt) return false;
      const critiqueDate = new Date(g.completedAt).getTime();
      if (critiqueDate < latestContentDate) return false;
      const critRevisionId = g.generationMetadata?.critiquePromptRevisionId;
      return critRevisionId === currentRevisionId;
    });
  })();

  // Block corrector when no critique exists for the latest content
  const correctionBlocked = !hasAssembly || critiqueGenerations.length === 0;
  const correctionBlockedReason = !hasAssembly
    ? "Assemble the chapter first"
    : "Run a critique first before correcting";

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
        currentPromptsHash={currentPromptsHash}
        activeBriefHash={data?.activeBrief?.hash ?? null}
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
                            navigator.clipboard.writeText(fragment.content)
                              .then(() => toast.success("Fragment copied"))
                              .catch(() => toast.error("Clipboard access denied"));
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
                {selectedAssemblyVersion.generationMetadata?.type === "correction" && (
                  <Badge variant="default" className="text-[10px] h-4 px-1.5 bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                    Corrected
                  </Badge>
                )}
                {selectedAssemblyVersionNumber > 0 && (
                  <Badge variant="secondary">v{selectedAssemblyVersionNumber}</Badge>
                )}
                <EditorialVersionBadge
                  generationMetadata={selectedAssemblyVersion.generationMetadata}
                  activeBrief={data.activeBrief}
                />
                {selectedAssemblyVersion.completedAt && (
                  <span>
                    {new Date(selectedAssemblyVersion.completedAt).toLocaleString()}
                  </span>
                )}
                <div className="flex-1" />
                {
                  selectedAssemblyVersion.generationMetadata?.type === "correction" &&
                    correctionOriginalText && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={() => setDiffModalOpen(true)}
                      >
                        Compare
                      </Button>
                    )
                }
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  onClick={() => {
                    navigator.clipboard.writeText(selectedAssemblyVersion.assembledContent ?? "")
                      .then(() => toast.success("Content copied"))
                      .catch(() => toast.error("Clipboard access denied"));
                  }}
                >
                  <Copy className="h-3 w-3 mr-1" /> Copy
                </Button>
              </div>

              <dl className="grid gap-2 rounded-md bg-muted/40 p-3 text-xs sm:grid-cols-2 lg:grid-cols-4 mb-4">
                <div>
                  <dt className="text-muted-foreground">Type</dt>
                  <dd className="font-medium">
                    {selectedAssemblyVersion.generationMetadata?.type === "correction" ? "Correction" : "Assembly"}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">
                    {selectedAssemblyVersion.generationMetadata?.type === "correction" ? "Corrector Prompt" : "Assembly Prompt"}
                  </dt>
                  <dd className="font-medium">
                    {selectedAssemblyVersion.generationMetadata?.type === "correction"
                      ? (selectedAssemblyVersion.generationMetadata?.promptTitle ?? "Unknown")
                      : (selectedAssemblyVersion.assemblyMetadata?.promptTitle ?? "Unknown")}
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
                    {selectedAssemblyVersion.generationMetadata?.model
                      ?? selectedAssemblyVersion.assemblyMetadata?.model
                      ?? "Unknown"}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">
                    {selectedAssemblyVersion.generationMetadata?.type === "correction" ? "Algorithm" : "Fragments"}
                  </dt>
                  <dd className="font-medium">
                    {selectedAssemblyVersion.generationMetadata?.type === "correction"
                      ? (selectedAssemblyVersion.assemblyMetadata?.algorithm ?? "correction")
                      : (selectedAssemblyVersion.assemblyMetadata?.fragmentCount ?? "Unknown")}
                  </dd>
                </div>
                {(selectedAssemblyVersion.assemblyMetadata?.plannerExecutionId ||
                  selectedAssemblyVersion.assemblyMetadata?.assemblyExecutionId) && (
                  <div>
                    <dt className="text-muted-foreground text-xs mt-1">Execution IDs</dt>
                    <dd className="text-[10px] font-mono text-muted-foreground/70 space-y-0.5 mt-0.5">
                      {selectedAssemblyVersion.assemblyMetadata?.plannerExecutionId && (
                        <div className="flex items-center gap-1">
                          <span className="shrink-0">Planner:</span>
                          <a
                            href={`/api/prompt-executions/${selectedAssemblyVersion.assemblyMetadata.plannerExecutionId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary hover:underline truncate"
                            title="Open planner execution (effective prompt, messages, usage)"
                          >
                            {selectedAssemblyVersion.assemblyMetadata.plannerExecutionId.slice(0, 8)}…
                          </a>
                        </div>
                      )}
                      {selectedAssemblyVersion.assemblyMetadata?.assemblyExecutionId && (
                        <div className="flex items-center gap-1">
                          <span className="shrink-0">Assembly:</span>
                          <a
                            href={`/api/prompt-executions/${selectedAssemblyVersion.assemblyMetadata.assemblyExecutionId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary hover:underline truncate"
                            title="Open assembly execution (effective prompt, messages, usage)"
                          >
                            {selectedAssemblyVersion.assemblyMetadata.assemblyExecutionId.slice(0, 8)}…
                          </a>
                        </div>
                      )}
                    </dd>
                  </div>
                )}
              </dl>

              {/* Assembly Plan Panel — semantic view for planned-editorial-v1 */}
              {selectedAssemblyVersion.assemblyMetadata?.algorithm === "planned-editorial-v1" &&
                selectedAssemblyVersion.assemblyPlan &&
                (() => {
                  const parsed = assemblyPlanV1Schema.safeParse(selectedAssemblyVersion.assemblyPlan);
                  if (!parsed.success) return null;
                  const plan = parsed.data;

                  const covered = plan.mustCover.filter((m) => m.status === "covered").length;
                  const bridgeable = plan.mustCover.filter((m) => m.status === "bridgeable").length;
                  const unsupportedCount = plan.mustCover.filter((m) => m.status === "unsupported").length;
                  const cuts = plan.sections.flatMap((s) =>
                    s.sourceTreatments.filter((t) => t.action === "cut").map((t) => ({
                      fragmentId: t.fragmentId,
                      reason: t.reason,
                    })),
                  );
                  const totalMustCover = plan.mustCover.length;
                  const pipeline =
                    (selectedAssemblyVersion.planningMetadata as Record<string, unknown> | null)?.pipeline as
                      | string
                      | undefined;

                  return (
                    <details className="rounded-md border bg-muted/30 px-3 py-2 text-xs mb-4">
                      <summary className="font-medium cursor-pointer select-none">
                        Assembly Plan
                        <span className="ml-2 text-muted-foreground font-normal">
                          ({plan.sections.length} sections{pipeline ? `, ${pipeline}` : ""})
                        </span>
                      </summary>

                      <div className="mt-2 space-y-2">
                        {/* Chapter intent */}
                        <p className="text-muted-foreground italic leading-relaxed">
                          {plan.chapterIntent}
                        </p>

                        {/* Coverage badges */}
                        {totalMustCover > 0 && (
                          <div className="flex flex-wrap gap-1.5">
                            <Badge variant="secondary" className="text-[10px] h-5 bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
                              ✓ {covered} covered
                            </Badge>
                            {bridgeable > 0 && (
                              <Badge variant="secondary" className="text-[10px] h-5 bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400">
                                ~ {bridgeable} bridgeable
                              </Badge>
                            )}
                            {unsupportedCount > 0 && (
                              <Badge variant="secondary" className="text-[10px] h-5 bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400">
                                ✗ {unsupportedCount} unsupported
                              </Badge>
                            )}
                          </div>
                        )}

                        {/* Sections — purposes and source treatments */}
                        <details className="text-[11px]">
                          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                            Sections ({plan.sections.length})
                          </summary>
                          <div className="mt-1 space-y-1.5">
                            {plan.sections.map((s) => (
                              <div key={s.id} className="pl-2 border-l-2 border-muted-foreground/20">
                                <div className="font-medium text-foreground">
                                  <code className="text-[10px]">{s.id.slice(0, 8)}…</code>
                                  {" — "}{s.purpose}
                                </div>
                                <div className="mt-0.5 flex flex-wrap gap-1">
                                  {s.sourceTreatments.map((t, j) => (
                                    <span
                                      key={j}
                                      className={`text-[10px] px-1 py-0.5 rounded ${
                                        t.action === "cut"
                                          ? "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"
                                          : t.action === "keep"
                                          ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
                                          : "bg-muted text-muted-foreground"
                                      }`}
                                    >
                                      {t.action}: <code>{t.fragmentId.slice(0, 6)}…</code>
                                    </span>
                                  ))}
                                </div>
                                {s.synthesis && (
                                  <div className="text-[10px] text-muted-foreground/70 mt-0.5">
                                    Synthesis: {s.synthesis}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </details>

                        {/* mustCover items — individual status and source fragments */}
                        {plan.mustCover.length > 0 && (
                          <details className="text-[11px]">
                            <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                              Coverage ({plan.mustCover.length})
                            </summary>
                            <ul className="mt-1 space-y-1">
                              {plan.mustCover.map((mc, i) => (
                                <li key={i} className="pl-2 border-l-2 border-muted-foreground/20">
                                  <span
                                    className={`text-[10px] font-medium px-1 py-0.5 rounded ${
                                      mc.status === "covered"
                                        ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
                                        : mc.status === "bridgeable"
                                        ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400"
                                        : "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"
                                    }`}
                                  >
                                    {mc.status}
                                  </span>{" "}
                                  <span className="text-foreground">{mc.item}</span>
                                  <div className="mt-0.5 text-[10px] text-muted-foreground">
                                    Sources:{" "}
                                    {mc.sourceFragmentIds.map((fid) => (
                                      <code key={fid} className="mr-1">{fid.slice(0, 6)}…</code>
                                    ))}
                                    {" · "}{mc.handling}
                                  </div>
                                </li>
                              ))}
                            </ul>
                          </details>
                        )}

                        {/* Cuts */}
                        {cuts.length > 0 && (
                          <details className="text-[11px]">
                            <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                              Cuts ({cuts.length})
                            </summary>
                            <ul className="mt-1 space-y-1 pl-4 list-disc text-muted-foreground">
                              {cuts.map((c, i) => (
                                <li key={i}>
                                  <code className="text-[10px]">{c.fragmentId.slice(0, 8)}…</code>
                                  {" — "}{c.reason}
                                </li>
                              ))}
                            </ul>
                          </details>
                        )}

                        {/* Bridges */}
                        {plan.bridges.length > 0 && (
                          <details className="text-[11px]">
                            <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                              Bridges ({plan.bridges.length})
                            </summary>
                            <ul className="mt-1 space-y-1.5">
                              {plan.bridges.map((b, i) => (
                                <li key={i} className="text-muted-foreground">
                                  <span className="font-medium text-foreground">
                                    {b.fromSectionId.slice(0, 8)}… → {b.toSectionId.slice(0, 8)}…
                                  </span>
                                  <br />
                                  <span className="text-[10px]">
                                    Connection: {b.logicalConnection}
                                  </span>
                                  {b.factualBoundary && (
                                    <>
                                      <br />
                                      <span className="text-[10px]">
                                        Boundary: {b.factualBoundary}
                                      </span>
                                    </>
                                  )}
                                </li>
                              ))}
                            </ul>
                          </details>
                        )}

                        {/* Gaps */}
                        {plan.unsupportedGaps.length > 0 && (
                          <details className="text-[11px]">
                            <summary className="cursor-pointer text-red-600 dark:text-red-400 hover:opacity-80">
                              Unsupported Gaps ({plan.unsupportedGaps.length})
                            </summary>
                            <ul className="mt-1 space-y-0.5 pl-4 list-disc text-muted-foreground">
                              {plan.unsupportedGaps.map((gap, i) => (
                                <li key={i}>{gap}</li>
                              ))}
                            </ul>
                          </details>
                        )}

                        {/* Execution IDs — open in dialog instead of raw JSON */}
                        <div className="text-[10px] text-muted-foreground/70 pt-1 border-t">
                          {selectedAssemblyVersion.assemblyMetadata?.plannerExecutionId && (
                            <button
                              onClick={() => openExecutionDialog(selectedAssemblyVersion.assemblyMetadata!.plannerExecutionId!)}
                              className="text-primary hover:underline cursor-pointer"
                              title="View planner execution details"
                            >
                              Planner execution
                            </button>
                          )}
                          {selectedAssemblyVersion.assemblyMetadata?.plannerExecutionId &&
                            selectedAssemblyVersion.assemblyMetadata?.assemblyExecutionId &&
                            " · "}
                          {selectedAssemblyVersion.assemblyMetadata?.assemblyExecutionId && (
                            <button
                              onClick={() => openExecutionDialog(selectedAssemblyVersion.assemblyMetadata!.assemblyExecutionId!)}
                              className="text-primary hover:underline cursor-pointer"
                              title="View assembly execution details"
                            >
                              Assembly execution
                            </button>
                          )}
                          {selectedAssemblyVersion.plannerPromptRevisionId && (
                            <>
                              <br />
                              Planner revision:{" "}
                              <code>{selectedAssemblyVersion.plannerPromptRevisionId.slice(0, 8)}…</code>
                            </>
                          )}
                          {selectedAssemblyVersion.assemblyPromptRevisionId && (
                            <>
                              {" · "}Assembly revision:{" "}
                              <code>{selectedAssemblyVersion.assemblyPromptRevisionId.slice(0, 8)}…</code>
                            </>
                          )}
                        </div>
                      </div>
                    </details>
                  );
                })()}

              <div className="prose prose-sm dark:prose-invert max-w-none text-sm">
                <ReactMarkdown rehypePlugins={[rehypeSanitize]}>
                  {selectedAssemblyVersion.assembledContent!}
                </ReactMarkdown>
              </div>

            </CardContent>
          </Card>
        </div>
      )}

      {
        correctionOriginalText && selectedAssemblyVersion?.assembledContent && (
          <DiffModal
            open={diffModalOpen}
            onOpenChange={setDiffModalOpen}
            originalTitle={`v${selectedAssemblyVersionNumber - 1}`}
            correctedTitle={`v${selectedAssemblyVersionNumber} (Corrected)`}
            originalText={correctionOriginalText}
            correctedText={selectedAssemblyVersion.assembledContent}
          />
        )
      }

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
                <EditorialVersionBadge
                  generationMetadata={selectedCritique.generationMetadata}
                  activeBrief={data.activeBrief}
                />
                <div className="flex-1" />
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  onClick={() => {
                    navigator.clipboard.writeText(selectedCritique.assembledContent ?? "")
                      .then(() => toast.success("Critique copied"))
                      .catch(() => toast.error("Clipboard access denied"));
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

      <AssemblyPromptSection
        planner={displayedPlanner}
        assembler={displayedAssembler}
        loading={revisionsLoading}
        error={revisionLoadError}
        onRetry={() => void refreshAssemblyPipeline()}
        onAssemble={openAssemblyModal}
        assembling={isAssemblingChapter}
        canAssemble={hasSelectableFragments}
      />

      <CritiquePromptSection
        prompt={reviewRegistry?.critique.effective ?? null}
        revisions={reviewRegistry?.critique.revisions ?? []}
        bindingRevisionId={reviewRegistry?.critique.bindingRevisionId ?? null}
        defaultRevisionId={reviewRegistry?.critique.defaultRevisionId ?? null}
        loading={reviewRegistryLoading}
        error={reviewRegistryError}
        saving={savingReviewKind === "critique"}
        onRetry={() => void refreshReviewRegistry()}
        onRevisionChange={(value) => void changeReviewPrompt("critique", value)}
        onCritique={runCritique}
        critiquing={critiquing}
        blocked={critiqueBlocked || isAssemblingChapter}
        blockedReason="Latest version already critiqued with this prompt"
        model={critiqueModel}
        onModelChange={setCritiqueModel}
      />

      <CorrectorPromptSection
        prompt={reviewRegistry?.corrector.effective ?? null}
        revisions={reviewRegistry?.corrector.revisions ?? []}
        bindingRevisionId={reviewRegistry?.corrector.bindingRevisionId ?? null}
        defaultRevisionId={reviewRegistry?.corrector.defaultRevisionId ?? null}
        loading={reviewRegistryLoading}
        error={reviewRegistryError}
        saving={savingReviewKind === "corrector"}
        onRetry={() => void refreshReviewRegistry()}
        onRevisionChange={(value) => void changeReviewPrompt("corrector", value)}
        onCorrect={() => setCorrectionTrigger((n) => n + 1)}
        correcting={correcting}
        blocked={correctionBlocked}
        blockedReason={correctionBlockedReason}
        model={correctorModel}
        onModelChange={setCorrectorModel}
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
          <div className="space-y-3 pt-4 border-t">
            {/* Model + revision selectors */}
            <div className="flex items-center gap-2 flex-wrap">
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

              <Select
                value={plannerRevisionId ?? "__default__"}
                onValueChange={(v) => setPlannerRevisionId(v === "__default__" ? undefined : v)}
                disabled={revisionsLoading || plannerRevisions.length === 0}
              >
                <SelectTrigger className="w-[210px] h-7 text-[10px]">
                  <SelectValue placeholder="Planner unavailable" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__default__" className="text-[10px]">
                    {assemblyPipeline?.planner
                      ? `Effective: ${assemblyPipeline.planner.name} v${assemblyPipeline.planner.versionLabel}`
                      : "No effective planner"}
                  </SelectItem>
                  {plannerRevisions.map((r) => (
                    <SelectItem key={r.id} value={r.id} className="text-[10px]">
                      {r.name} v{r.versionLabel}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={assemblyRevisionId ?? "__default__"}
                onValueChange={(v) => setAssemblyRevisionId(v === "__default__" ? undefined : v)}
                disabled={revisionsLoading || assemblyRevisions.length === 0}
              >
                <SelectTrigger className="w-[210px] h-7 text-[10px]">
                  <SelectValue placeholder="Assembler unavailable" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__default__" className="text-[10px]">
                    {assemblyPipeline?.assembler
                      ? `Effective: ${assemblyPipeline.assembler.name} v${assemblyPipeline.assembler.versionLabel}`
                      : "No effective assembler"}
                  </SelectItem>
                  {assemblyRevisions.map((r) => (
                    <SelectItem key={r.id} value={r.id} className="text-[10px]">
                      {r.name} v{r.versionLabel}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {revisionsLoading && (
                <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
              )}
            </div>

            {revisionLoadError && (
              <div className="flex items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
                <p className="text-xs text-destructive">{revisionLoadError}</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void refreshAssemblyPipeline()}
                >
                  Retry
                </Button>
              </div>
            )}

            <div className="flex justify-end">
              <Button
                size="sm"
                onClick={runAssembly}
                disabled={
                  isAssemblingChapter ||
                  revisionsLoading ||
                  Boolean(revisionLoadError) ||
                  !displayedPlanner ||
                  !displayedAssembler ||
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
          </div>
        </DialogContent>
      </Dialog>

      {/* Corrector Section */}
      <CorrectorSection
        projectId={params.id}
        chapterId={params.chapterId}
        generations={generations}
        hasAssembly={hasAssembly}
        correctorPromptRevisionId={reviewRegistry?.corrector.effective?.id}
        correctionTrigger={correctionTrigger}
        correctorModel={correctorModel}
        onCorrectingChange={setCorrecting}
        onGenerationCreated={() => {
          fetchChapter();
          fetchPlaceholders();
        }}
        selectedCritiqueGenerationId={selectedCritiqueGenerationId}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        description="Delete this prompt?"
        onConfirm={confirmDelete}
      />

      {/* Execution Detail Dialog */}
      <Dialog open={executionDialogOpen} onOpenChange={setExecutionDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Prompt Execution</DialogTitle>
            <DialogDescription>
              Effective prompt, messages, and metadata
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto -mx-6 px-6">
            {executionDialogLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : executionDialogData ? (
                <div className="space-y-4 text-sm">
                  {/* Meta row */}
                  <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                    {executionDialogData.stage && (
                      <Badge variant="secondary" className="text-[10px] h-5">
                        Stage: {executionDialogData.stage}
                      </Badge>
                    )}
                    {executionDialogData.status && (
                      <Badge
                        variant="secondary"
                        className={`text-[10px] h-5 ${
                          executionDialogData.status === "completed"
                            ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
                            : executionDialogData.status === "failed"
                            ? "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"
                            : ""
                        }`}
                      >
                        {executionDialogData.status}
                      </Badge>
                    )}
                    <span>Model: {executionDialogData.model ?? "?"}</span>
                    <span>Provider: {executionDialogData.provider ?? "?"}</span>
                    {executionDialogData.revision && (
                      <span>
                        Revision:{" "}
                        {executionDialogData.revision.definitionName ?? "?"}{" "}
                        {executionDialogData.revision.versionLabel ?? "?"}
                      </span>
                    )}
                    {executionDialogData.createdAt && (
                      <span className="font-mono">
                        {new Date(executionDialogData.createdAt).toLocaleString()}
                      </span>
                    )}
                    {executionDialogData.completedAt && (
                      <span className="font-mono">
                        → {new Date(executionDialogData.completedAt).toLocaleString()}
                      </span>
                    )}
                  </div>

                  {/* Error — shown inline with details, not instead of them */}
                  {executionDialogData.error && (
                    <div className="rounded-md bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 p-3">
                      <p className="text-xs font-medium text-red-800 dark:text-red-400 mb-1">Error</p>
                      <pre className="text-[11px] text-red-700 dark:text-red-300 whitespace-pre-wrap font-mono">
                        {executionDialogData.error}
                      </pre>
                    </div>
                  )}

                  {/* Messages */}
                  {executionDialogData.messages && executionDialogData.messages.length > 0 && (
                    <div className="space-y-3">
                      <p className="text-xs font-medium text-muted-foreground">
                        Messages ({executionDialogData.messages.length})
                      </p>
                      {executionDialogData.messages.map((msg, i) => (
                        <div key={i} className="rounded-md border bg-muted/30 p-3">
                          <p className="text-[10px] font-medium text-muted-foreground mb-1 uppercase">
                            {msg.role}
                          </p>
                          <pre className="text-[11px] whitespace-pre-wrap font-mono text-foreground">
                            {msg.content}
                          </pre>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Contract */}
                  {executionDialogData.outputContract && (
                    <div className="rounded-md border bg-muted/30 p-3">
                      <p className="text-[10px] font-medium text-muted-foreground mb-1">Output Contract</p>
                      <pre className="text-[11px] whitespace-pre-wrap font-mono text-muted-foreground">
                        {executionDialogData.outputContract}
                      </pre>
                    </div>
                  )}

                  {/* Technical Policies */}
                  {executionDialogData.technicalPolicies && executionDialogData.technicalPolicies.length > 0 && (
                    <div>
                      <p className="text-[10px] font-medium text-muted-foreground mb-1">Technical Policies</p>
                      <div className="flex flex-wrap gap-1">
                        {executionDialogData.technicalPolicies.map((p, i) => (
                          <Badge key={i} variant="secondary" className="text-[10px] h-5">
                            {p}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Data Manifest / Lineage */}
                  {executionDialogData.dataManifest && (
                    <details className="text-[11px]">
                      <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                        Data Lineage
                      </summary>
                      <pre className="mt-1 text-[10px] whitespace-pre-wrap font-mono text-muted-foreground max-h-48 overflow-y-auto">
                        {JSON.stringify(executionDialogData.dataManifest, null, 2)}
                      </pre>
                    </details>
                  )}

                  {/* Usage */}
                  {executionDialogData.usage && (
                    <div className="text-[10px] text-muted-foreground border-t pt-2 font-mono">
                      {executionDialogData.usage.promptTokens != null && (
                        <span>Prompt: {executionDialogData.usage.promptTokens} tokens</span>
                      )}
                      {executionDialogData.usage.completionTokens != null && (
                        <span> · Completion: {executionDialogData.usage.completionTokens} tokens</span>
                      )}
                      {executionDialogData.usage.totalTokens != null && (
                        <span> · Total: {executionDialogData.usage.totalTokens} tokens</span>
                      )}
                    </div>
                  )}
                </div>
              )
            : null}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
