"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Loader2,
  Sparkles,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  CheckCircle2,
  Circle,
  AlertCircle,
  Pencil,
} from "lucide-react";
import { toast } from "sonner";
import type { ChapterPlaceholder } from "@/lib/db/schema";
import { MODEL_OPTIONS, DEFAULT_GENERATION_MODEL } from "@/lib/ai/providers";
import type { PlaceholderFillMetadata } from "@/lib/placeholder-fill-metadata";
import { inferPlaceholderProvider } from "@/lib/placeholder-research";
import { needsPlaceholderFill } from "@/lib/placeholder-utils";

const MODELS = MODEL_OPTIONS;

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  provider: string;
}

export interface EnrichedPlaceholder extends ChapterPlaceholder {
  versions?: Array<{
    id: string;
    definition: string | null;
    fillMetadata: PlaceholderFillMetadata | null;
    createdAt: string;
  }>;
}

interface Props {
  projectId: string;
  chapterId: string;
  placeholders: EnrichedPlaceholder[];
  onSaveDefinition: (name: string, definition: string | null) => Promise<void>;
  onFillComplete?: () => void | Promise<void>;
  currentPromptsHash?: string;
  activeBriefHash?: string | null;
}

type FillStatus = "pending" | "generating" | "filled" | "error" | "blocked";

interface PlaceholderState {
  definition: string | null;
  status: FillStatus;
  sources: SearchResult[];
  ragChunks?: number;
  provider?: string;
  insufficientReason?: string;
}

export function PlaceholderFillSection({
  projectId,
  chapterId,
  placeholders,
  onSaveDefinition,
  onFillComplete,
  currentPromptsHash,
  activeBriefHash,
}: Props) {
  const [model, setModel] = useState(DEFAULT_GENERATION_MODEL);
  const [filling, setFilling] = useState(false);
  const [fillingOne, setFillingOne] = useState<Set<string>>(new Set());
  const [states, setStates] = useState<Record<string, PlaceholderState>>({});
  const [expandedSources, setExpandedSources] = useState<Record<string, boolean>>({});
  const [editingName, setEditingName] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [changingVersion, setChangingVersion] = useState<Set<string>>(new Set());
  const editRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Cleanup: abort any in-flight stream on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const getState = useCallback((name: string): PlaceholderState => {
    const placeholder = placeholders.find((p) => p.name === name);
    const metadata = placeholder?.fillMetadata as PlaceholderFillMetadata | null | undefined;
    // Detect blocked state from metadata (insufficient_evidence without definition)
    const isBlocked = metadata?.status === "insufficient_evidence" && !placeholder?.definition;
    return states[name] ?? {
      definition: placeholder?.definition ?? "",
      status: isBlocked ? "blocked" : (placeholder?.definition ? "filled" : "pending"),
      sources: metadata?.sources ?? [],
      ragChunks: metadata?.ragChunks,
      provider: metadata?.provider ?? (
        placeholder
          ? inferPlaceholderProvider(placeholder.name, placeholder.function)
          : undefined
      ),
      insufficientReason: metadata?.insufficientReason,
    };
  }, [placeholders, states]);

  const progress = Object.values(states).filter((s) => s.status === "filled").length;
  const total = placeholders.length;

  const fillAll = useCallback(async () => {
    // Abort any previous stream
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const { signal } = controller;

    setFilling(true);
    // Keep fresh definitions filled; backend skips them during bulk fill.
    const init: Record<string, PlaceholderState> = {};
    for (const ph of placeholders) {
      const metadata = ph.fillMetadata as PlaceholderFillMetadata | null | undefined;
      const needsFill = needsPlaceholderFill(
        ph.definition,
        metadata,
        currentPromptsHash ?? metadata?.promptsHash ?? "",
        activeBriefHash,
      );
      init[ph.name] = {
        definition: ph.definition ?? "",
        status: needsFill ? "pending" : "filled",
        sources: metadata?.sources ?? [],
        ragChunks: metadata?.ragChunks,
        provider: metadata?.provider ?? inferPlaceholderProvider(ph.name, ph.function),
      };
    }
    setStates(init);

    try {
      const res = await fetch(
        `/api/projects/${projectId}/chapters/${chapterId}/placeholders/fill`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model, effort: "max" }),
          signal,
        },
      );

      if (!res.ok) {
        toast.error("Error starting fill");
        setFilling(false);
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        setFilling(false);
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";

      function processLines(lines: string[]) {
        let doneFilled = 0;
        let doneFailed = 0;
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const dataStr = line.slice(6);
          try {
            const event = JSON.parse(dataStr);
            if (event.type === "placeholder" && event.name) {
              setStates((prev) => ({
                ...prev,
                [event.name]: {
                  definition: event.definition ?? "",
                  status: "filled",
                  sources: event.sources ?? [],
                  ragChunks: event.ragChunks,
                  provider: event.provider,
                },
              }));
            } else if (event.type === "blocked" && event.name) {
              setStates((prev) => ({
                ...prev,
                [event.name]: {
                  definition: "",
                  status: "blocked",
                  sources: event.sources ?? [],
                  ragChunks: event.ragChunks,
                  provider: event.provider,
                  insufficientReason: event.insufficientReason,
                },
              }));
            } else if (event.type === "error") {
              if (event.name) {
                setStates((prev) => ({
                  ...prev,
                  [event.name]: {
                    ...(prev[event.name] ?? { definition: "", sources: [] }),
                    status: "error",
                  },
                }));
              }
              toast.error(event.error ?? "Error filling placeholder");
            } else if (event.type === "done") {
              doneFilled = event.filled ?? event.total ?? total;
              doneFailed = event.failed ?? 0;
              if (doneFailed === 0) {
                toast.success(`${doneFilled} placeholders filled`);
              } else {
                toast.warning(`${doneFilled} filled, ${doneFailed} failed`);
              }
              void onFillComplete?.();
            }
          } catch {
            // ignore malformed JSON
          }
        }
      }

      while (true) {
        if (signal.aborted) break;
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        processLines(lines);
      }

      // Flush remaining buffer only if not aborted
      if (!signal.aborted) {
        buffer += decoder.decode();
        if (buffer.trim()) {
          processLines(buffer.split("\n"));
        }
      }
    } catch {
      if (!signal.aborted) {
        toast.error("Stream error");
      }
    } finally {
      setFilling(false);
    }
  }, [
    projectId,
    chapterId,
    model,
    placeholders,
    total,
    onFillComplete,
    currentPromptsHash,
    activeBriefHash,
  ]);

  const fillOne = useCallback(async (phName: string) => {
    setFillingOne((prev) => new Set(prev).add(phName));
    setStates((prev) => ({
      ...prev,
      [phName]: {
        ...getState(phName),
        status: "generating",
      },
    }));

    try {
      const res = await fetch(
        `/api/projects/${projectId}/chapters/${chapterId}/placeholders/${encodeURIComponent(phName)}/fill`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model, effort: "max" }),
        },
      );

      if (res.ok) {
        const data = await res.json();
        if (data.status === "insufficient_evidence") {
          setStates((prev) => ({
            ...prev,
            [phName]: {
              definition: "",
              status: "blocked",
              sources: data.sources ?? [],
              ragChunks: data.ragChunks,
              provider: data.provider,
              insufficientReason: data.insufficientReason,
            },
          }));
          toast.warning(data.insufficientReason ?? `Insufficient evidence for {${phName}}`);
        } else {
          setStates((prev) => ({
            ...prev,
            [phName]: {
              definition: data.definition ?? "",
              status: "filled",
              sources: data.sources ?? [],
              ragChunks: data.ragChunks,
              provider: data.provider,
            },
          }));
        }
        void onFillComplete?.();
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error ?? `Error filling {${phName}}`);
        setStates((prev) => ({
          ...prev,
          [phName]: { ...(prev[phName] ?? { definition: "", sources: [] }), status: "error" },
        }));
      }
    } catch {
      toast.error("Network error");
      setStates((prev) => ({
        ...prev,
        [phName]: { ...(prev[phName] ?? { definition: "", sources: [] }), status: "error" },
      }));
    } finally {
      setFillingOne((prev) => {
        const next = new Set(prev);
        next.delete(phName);
        return next;
      });
    }
  }, [projectId, chapterId, model, onFillComplete, getState]);

  function startEdit(name: string) {
    const state = getState(name);
    setEditingName(name);
    setEditValue(state.definition ?? "");
    setTimeout(() => editRef.current?.focus(), 0);
  }

  async function commitEdit() {
    if (!editingName) return;
    const trimmed = editValue.trim();
    setStates((prev) => ({
      ...prev,
      [editingName]: {
        ...getState(editingName),
        definition: trimmed || null,
        status: trimmed ? "filled" : "pending",
      },
    }));
    setEditingName(null);
    try {
      // Always persist — pass empty string to clear, actual value otherwise.
      // The API supports null definition and treats empty string as clear.
      await onSaveDefinition(editingName, trimmed || null);
    } catch {
      toast.error("Error saving definition");
    }
  }

  function cancelEdit() {
    setEditingName(null);
  }

  function statusIcon(status: FillStatus) {
    switch (status) {
      case "filled":
        return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 flex-shrink-0" />;
      case "generating":
        return <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-500 flex-shrink-0" />;
      case "error":
        return <AlertCircle className="h-3.5 w-3.5 text-destructive flex-shrink-0" />;
      case "blocked":
        return <AlertCircle className="h-3.5 w-3.5 text-orange-500 flex-shrink-0" />;
      case "pending":
        return <Circle className="h-3.5 w-3.5 text-muted-foreground/40 flex-shrink-0" />;
    }
  }

  if (placeholders.length === 0) return null;

  return (
    <div className="mb-6">
      {/* Header bar */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-medium text-muted-foreground">Placeholders</h2>
          {filling && (
            <span className="text-[10px] text-muted-foreground tabular-nums">
              {progress}/{total}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Select value={model} onValueChange={setModel} disabled={filling}>
            <SelectTrigger className="w-[140px] h-7 text-[11px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MODELS.map((m) => (
                <SelectItem key={m.id} value={m.id} className="text-[11px]">
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            className="text-xs h-7"
            onClick={fillAll}
            disabled={filling}
          >
            {filling ? (
              <Loader2 className="h-3 w-3 animate-spin mr-1" />
            ) : (
              <Sparkles className="h-3 w-3 mr-1" />
            )}
            Fill All
          </Button>
        </div>
      </div>

      {/* Placeholder cards */}
      <Card>
        <CardContent className="pt-3 pb-1 space-y-0">
          {placeholders.map((ph) => {
            const state = getState(ph.name);
            const isEditing = editingName === ph.name;
            const hasSources = state.sources.length > 0;
            const isExpanded = expandedSources[ph.name] ?? false;
            const isStale = Boolean(
              (state.status === "filled" || state.status === "blocked")
                && (() => {
                  const placeholder = placeholders.find((p) => p.name === ph.name);
                  const metadata = placeholder?.fillMetadata as PlaceholderFillMetadata | null | undefined;
                  const promptsStale = currentPromptsHash && metadata?.promptsHash && metadata.promptsHash !== currentPromptsHash;
                  const briefStale = activeBriefHash && metadata?.editorialBriefHash !== activeBriefHash;
                  return promptsStale || briefStale;
                })()
            );

            return (
              <div
                key={ph.id}
                className={`py-2.5 -mx-3 px-3 rounded-md transition-colors ${
                  state.status === "generating"
                    ? "bg-amber-500/5"
                    : state.status === "error"
                      ? "bg-destructive/5"
                      : state.status === "blocked"
                        ? "bg-orange-500/5"
                        : ""
                }`}
              >
                {/* Top row: name + status */}
                <div className="flex items-center gap-2 mb-1">
                  {statusIcon(state.status)}
                  <code className="text-[11px] font-semibold text-foreground/80 bg-muted/50 px-1.5 py-0.5 rounded">
                    {"{"}{ph.name}{"}"}
                  </code>
                  {isStale && (
                    <span className="text-[9px] px-1 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 flex-shrink-0" title="Prompts changed since last fill — definition may be outdated">
                      stale
                    </span>
                  )}
                  <div className="flex-1 min-w-0">
                    {ph.function && (
                      <span className="text-[10px] text-muted-foreground truncate block">
                        {ph.function}
                      </span>
                    )}
                  </div>
                  {state.status !== "generating" && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-5 w-5 flex-shrink-0 text-muted-foreground/50 hover:text-foreground"
                      onClick={() => fillOne(ph.name)}
                      disabled={filling || fillingOne.has(ph.name)}
                      title={`Fill {${ph.name}}`}
                    >
                      <Sparkles className="h-2.5 w-2.5" />
                    </Button>
                  )}
                  {state.provider && (
                    <span className={`text-[9px] px-1 py-0.5 rounded flex-shrink-0 ${
                      state.provider === "rag"
                        ? "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400"
                        : state.provider === "semantic-scholar"
                          ? "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400"
                          : state.provider === "llm"
                            ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                            : state.provider === "direct"
                              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                              : state.provider === "reused"
                                ? "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400"
                                : "bg-muted text-muted-foreground"
                    }`}>
                      {state.provider === "rag"
                        ? state.ragChunks
                          ? `RAG (${state.ragChunks})`
                          : "RAG"
                        : state.provider === "semantic-scholar"
                          ? "Semantic Scholar"
                          : state.provider === "llm"
                            ? "LLM"
                            : state.provider === "direct"
                              ? "Direct"
                              : state.provider === "reused"
                                ? "Reused"
                                : state.provider}
                    </span>
                  )}
                  {state.status === "filled" && !isEditing && (
                    <button
                      type="button"
                      className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-0.5 flex-shrink-0"
                      onClick={() => startEdit(ph.name)}
                    >
                      <Pencil className="h-2.5 w-2.5" />
                      edit
                    </button>
                  )}
                  {
                    /* Version dots */
                  }
                  {ph.versions && ph.versions.length > 1 && (
                    <div className="flex items-center gap-0.5 ml-1 flex-shrink-0">
                      <span className="text-[9px] text-muted-foreground/50">v:</span>
                      {ph.versions.map((v, i) => {
                        const isActive = v.id === ph.activeVersionId;
                        const isLoading = changingVersion.has(ph.name);
                        return (
                          <button
                            key={v.id}
                            type="button"
                            disabled={isLoading}
                            onClick={async (e) => {
                              e.stopPropagation();
                              if (v.id === ph.activeVersionId) return;
                              setChangingVersion((prev) => new Set(prev).add(ph.name));
                              try {
                                const res = await fetch(
                                  `/api/projects/${projectId}/chapters/${chapterId}/placeholders/${encodeURIComponent(ph.name)}/version`,
                                  {
                                    method: 'PATCH',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ activeVersionId: v.id }),
                                  },
                                );
                                if (res.ok) {
                                  await onFillComplete?.();
                                } else {
                                  const err = await res.json().catch(() => ({}));
                                  toast.error(err.error ?? 'Failed to switch version');
                                }
                              } catch {
                                toast.error('Network error');
                              } finally {
                                setChangingVersion((prev) => {
                                  const next = new Set(prev);
                                  next.delete(ph.name);
                                  return next;
                                });
                              }
                            }}
                            className={`text-[9px] px-1 py-px rounded transition-colors ${
                              isActive
                                ? 'bg-primary text-primary-foreground'
                                : 'bg-muted text-muted-foreground hover:bg-muted/70'
                            } ${isLoading ? 'opacity-50' : ''}`}
                          >
                            {isLoading ? (
                              <Loader2 className="h-2 w-2 animate-spin" />
                            ) : (
                              `v${ph.versions!.length - i}`
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Definition */}
                {isEditing ? (
                  <div className="space-y-1.5">
                    <Textarea
                      ref={editRef}
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      className="text-xs min-h-[60px]"
                      placeholder={`Define {${ph.name}}...`}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") {
                          cancelEdit();
                        } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                          commitEdit();
                        }
                      }}
                    />
                    <div className="flex gap-1 justify-end">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-[10px]"
                        onClick={cancelEdit}
                      >
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        className="h-6 text-[10px]"
                        onClick={commitEdit}
                      >
                        Save
                      </Button>
                    </div>
                  </div>
                ) : state.status === "blocked" ? (
                  <p className="text-[11px] leading-relaxed text-orange-600 dark:text-orange-400 ml-5.5 pl-0.5">
                    {state.insufficientReason ?? "Insufficient evidence — add more details or change placeholder notes."}
                  </p>
                ) : state.definition ? (
                  <p className="text-[11px] leading-relaxed text-muted-foreground ml-5.5 pl-0.5">
                    {state.definition}
                  </p>
                ) : (
                  <p className="text-[11px] text-muted-foreground/50 italic ml-5.5 pl-0.5">
                    {filling ? "Waiting..." : "No definition"}
                  </p>
                )}

                {/* Error message */}
                {ph.notes && !isEditing && (
                  <p className="text-[10px] text-muted-foreground/60 italic mt-0.5 ml-5.5 line-clamp-2">
                    {ph.notes}
                  </p>
                )}

                {state.status === "error" && (
                  <p className="text-[11px] text-destructive mt-1 ml-5.5">
                    Failed to generate. Click the sparkle icon to retry.
                  </p>
                )}
                {state.status === "blocked" && (
                  <p className="text-[11px] text-orange-600 dark:text-orange-400 mt-1 ml-5.5">
                    Blocked — insufficient evidence. Add source material or update notes, then retry.
                  </p>
                )}

                {/* Sources */}
                {hasSources && (
                  <div className="mt-1.5 ml-5.5">
                    <button
                      type="button"
                      className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
                      onClick={() =>
                        setExpandedSources((prev) => ({
                          ...prev,
                          [ph.name]: !prev[ph.name],
                        }))
                      }
                      aria-expanded={isExpanded}
                    >
                      {isExpanded ? (
                        <ChevronDown className="h-2.5 w-2.5" />
                      ) : (
                        <ChevronRight className="h-2.5 w-2.5" />
                      )}
                      Sources ({state.sources.length})
                    </button>
                    {isExpanded && (
                      <div className="mt-1 space-y-0.5 ml-3.5">
                        {state.sources.map((s, i) => (
                          <a
                            key={i}
                            href={s.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-start gap-1 text-[10px] text-muted-foreground hover:text-foreground block"
                          >
                            <ExternalLink className="h-2.5 w-2.5 mt-0.5 flex-shrink-0" />
                            <span className="truncate">
                              {s.title}
                              <span className="text-muted-foreground/50 ml-0.5">
                                ({s.provider})
                              </span>
                            </span>
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
