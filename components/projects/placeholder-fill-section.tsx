"use client";

import { useState, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { MODEL_OPTIONS } from "@/lib/ai/providers";

const MODELS = MODEL_OPTIONS;

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  provider: string;
}

interface Props {
  projectId: string;
  chapterId: string;
  placeholders: ChapterPlaceholder[];
  onSaveDefinition: (name: string, definition: string) => Promise<void>;
}

type FillStatus = "pending" | "generating" | "filled" | "error";

interface PlaceholderState {
  definition: string;
  status: FillStatus;
  sources: SearchResult[];
  ragChunks?: number;
  provider?: string;
}

export function PlaceholderFillSection({
  projectId,
  chapterId,
  placeholders,
  onSaveDefinition,
}: Props) {
  const [model, setModel] = useState("deepseek-v4-pro");
  const [effort, setEffort] = useState<string>("max");
  const [temperature, setTemperature] = useState(0.7);
  const [filling, setFilling] = useState(false);
  const [states, setStates] = useState<Record<string, PlaceholderState>>({});
  const [expandedSources, setExpandedSources] = useState<Record<string, boolean>>({});
  const [editingName, setEditingName] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const editRef = useRef<HTMLTextAreaElement>(null);

  function getState(name: string): PlaceholderState {
    return states[name] ?? {
      definition: placeholders.find((p) => p.name === name)?.definition ?? "",
      status: placeholders.find((p) => p.name === name)?.definition ? "filled" : "pending",
      sources: [],
    };
  }

  const progress = Object.values(states).filter((s) => s.status === "filled").length;
  const total = placeholders.length;

  const fillAll = useCallback(async () => {
    setFilling(true);
    // Reset all to pending
    const init: Record<string, PlaceholderState> = {};
    for (const ph of placeholders) {
      init[ph.name] = {
        definition: ph.definition ?? "",
        status: "pending",
        sources: [],
      };
    }
    setStates(init);

    try {
      const res = await fetch(
        `/api/projects/${projectId}/chapters/${chapterId}/placeholders/fill`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model, effort, temperature }),
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
              toast.success(`${event.total ?? total} placeholders filled`);
            }
          } catch {
            // ignore malformed JSON
          }
        }
      }

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        processLines(lines);
      }

      buffer += decoder.decode();
      if (buffer.trim()) {
        processLines(buffer.split("\n"));
      }
    } catch {
      toast.error("Stream error");
    } finally {
      setFilling(false);
    }
  }, [projectId, chapterId, model, effort, temperature, placeholders, total]);

  function startEdit(name: string) {
    const state = getState(name);
    setEditingName(name);
    setEditValue(state.definition);
    setTimeout(() => editRef.current?.focus(), 0);
  }

  async function commitEdit() {
    if (!editingName) return;
    const trimmed = editValue.trim();
    setStates((prev) => ({
      ...prev,
      [editingName]: {
        ...getState(editingName),
        definition: trimmed,
        status: trimmed ? "filled" : "pending",
      },
    }));
    setEditingName(null);
    if (trimmed) {
      try {
        await onSaveDefinition(editingName, trimmed);
      } catch {
        toast.error("Error saving definition");
      }
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
          <Select value={effort} onValueChange={setEffort} disabled={filling}>
            <SelectTrigger className="w-[62px] h-7 text-[11px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="max" className="text-[11px]">Max</SelectItem>
              <SelectItem value="off" className="text-[11px]">Alto</SelectItem>
            </SelectContent>
          </Select>
          {effort === "off" && (
            <Input
              type="number"
              min={0}
              max={1}
              step={0.1}
              value={temperature}
              onChange={(e) => { const v = parseFloat(e.target.value); setTemperature(isNaN(v) ? 0.7 : v); }}
              className="w-[52px] h-7 text-[11px] px-1"
              disabled={filling}
            />
          )}
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

            return (
              <div
                key={ph.id}
                className={`py-2.5 -mx-3 px-3 rounded-md transition-colors ${
                  state.status === "generating"
                    ? "bg-amber-500/5"
                    : state.status === "error"
                      ? "bg-destructive/5"
                      : ""
                }`}
              >
                {/* Top row: name + status */}
                <div className="flex items-center gap-2 mb-1">
                  {statusIcon(state.status)}
                  <code className="text-[11px] font-semibold text-foreground/80 bg-muted/50 px-1.5 py-0.5 rounded">
                    {"{"}{ph.name}{"}"}
                  </code>
                  <div className="flex-1 min-w-0">
                    {ph.function && (
                      <span className="text-[10px] text-muted-foreground truncate block">
                        {ph.function}
                      </span>
                    )}
                  </div>
                  {state.provider && state.provider !== "none" && state.provider !== "direct" && (
                    <span className={`text-[9px] px-1 py-0.5 rounded flex-shrink-0 ${
                      state.provider === "rag"
                        ? "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400"
                        : state.provider === "semantic-scholar"
                          ? "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400"
                          : "bg-muted text-muted-foreground"
                    }`}>
                      {state.provider === "rag" && state.ragChunks
                        ? `RAG (${state.ragChunks})`
                        : state.provider === "semantic-scholar"
                          ? "Semantic Scholar"
                          : "Web"}
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
                    Failed to generate. Click Fill All to retry.
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
