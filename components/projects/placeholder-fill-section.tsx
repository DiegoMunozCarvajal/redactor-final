"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  RefreshCw,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Save,
} from "lucide-react";
import { toast } from "sonner";
import type { ChapterPlaceholder } from "@/lib/db/schema";

const MODELS = [
  { id: "deepseek-v4-flash", label: "DeepSeek V4 Flash" },
  { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro" },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
  { id: "claude-opus-4-7", label: "Claude Opus 4.7" },
];

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
  onSaveDefinitions: () => Promise<void>;
  savingPlaceholders: boolean;
}

export function PlaceholderFillSection({
  projectId,
  chapterId,
  placeholders,
  onSaveDefinitions,
  savingPlaceholders,
}: Props) {
  const [fillModel, setFillModel] = useState("deepseek-v4-pro");
  const [filling, setFilling] = useState(false);
  const [fillingName, setFillingName] = useState<string | null>(null);
  const [definitions, setDefinitions] = useState<Record<string, string>>({});
  const [sources, setSources] = useState<Record<string, SearchResult[]>>({});
  const [expandedSources, setExpandedSources] = useState<
    Record<string, boolean>
  >({});

  function getDefinition(name: string): string {
    return (
      definitions[name] ??
      placeholders.find((p) => p.name === name)?.definition ??
      ""
    );
  }

  async function fillAll() {
    setFilling(true);
    setSources({});
    try {
      const res = await fetch(
        `/api/projects/${projectId}/chapters/${chapterId}/placeholders/fill`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: fillModel }),
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
              setDefinitions((prev) => ({
                ...prev,
                [event.name]: event.definition,
              }));
              if (event.sources?.length > 0) {
                setSources((prev) => ({
                  ...prev,
                  [event.name]: event.sources,
                }));
              }
            } else if (event.type === "done") {
              toast.success("Placeholders filled");
            } else if (event.type === "error") {
              toast.error(event.error ?? "Error filling");
            }
          } catch {
            // ignore malformed JSON in stream
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

      // Flush remaining decoder bytes
      buffer += decoder.decode();
      if (buffer.trim()) {
        processLines(buffer.split("\n"));
      }
    } catch {
      toast.error("Stream error");
    } finally {
      setFilling(false);
    }
  }

  async function fillOne(name: string) {
    setFillingName(name);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/chapters/${chapterId}/placeholders/${encodeURIComponent(name)}/fill`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: fillModel }),
        },
      );
      if (res.ok) {
        const data = await res.json();
        setDefinitions((prev) => ({
          ...prev,
          [data.name]: data.definition,
        }));
        if (data.sources?.length > 0) {
          setSources((prev) => ({
            ...prev,
            [data.name]: data.sources,
          }));
        }
        toast.success(`{${name}} filled`);
      } else {
        toast.error(`Error filling {${name}}`);
      }
    } catch {
      toast.error("Network error");
    } finally {
      setFillingName(null);
    }
  }

  if (placeholders.length === 0) return null;

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-medium text-muted-foreground">
          Placeholders
        </h2>
        <div className="flex items-center gap-2">
          <Select value={fillModel} onValueChange={setFillModel}>
            <SelectTrigger className="w-[130px] h-7 text-[10px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MODELS.map((m) => (
                <SelectItem key={m.id} value={m.id} className="text-[10px]">
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            className="text-xs"
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

      <Card>
        <CardContent className="pt-4 space-y-3">
          {placeholders.map((ph) => {
            const def = getDefinition(ph.name);
            const srcs = sources[ph.name] ?? [];
            const isFillingThis = fillingName === ph.name;

            return (
              <div key={ph.id} className="space-y-1.5">
                <Label className="text-[10px] text-muted-foreground">
                  {"{"}
                  {ph.name}
                  {"}"}
                </Label>
                <div className="flex gap-2">
                  <Input
                    value={def}
                    onChange={(e) =>
                      setDefinitions((prev) => ({
                        ...prev,
                        [ph.name]: e.target.value,
                      }))
                    }
                    className="text-xs h-8 flex-1"
                    placeholder={
                      isFillingThis
                        ? "generating..."
                        : `Define "${ph.name}"...`
                    }
                    disabled={isFillingThis}
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 flex-shrink-0"
                    onClick={() => fillOne(ph.name)}
                    disabled={isFillingThis || filling}
                    aria-label={`Regenerate {${ph.name}}`}
                  >
                    {isFillingThis ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3 w-3 text-muted-foreground" />
                    )}
                  </Button>
                </div>

                {srcs.length > 0 && (
                  <div className="text-[10px]">
                    <button
                      type="button"
                      className="flex items-center gap-1 text-muted-foreground hover:text-foreground"
                      onClick={() =>
                        setExpandedSources((prev) => ({
                          ...prev,
                          [ph.name]: !prev[ph.name],
                        }))
                      }
                      aria-expanded={!!expandedSources[ph.name]}
                    >
                      {expandedSources[ph.name] ? (
                        <ChevronDown className="h-3 w-3" />
                      ) : (
                        <ChevronRight className="h-3 w-3" />
                      )}
                      Sources ({srcs.length})
                    </button>
                    {expandedSources[ph.name] && (
                      <div className="mt-1 space-y-1 ml-4">
                        {srcs.map((s, i) => (
                          <a
                            key={i}
                            href={s.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-start gap-1 text-muted-foreground hover:text-foreground"
                          >
                            <ExternalLink className="h-2.5 w-2.5 mt-0.5 flex-shrink-0" />
                            <span>
                              {s.title} ({s.provider})
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

          <div className="flex justify-end pt-2">
            <Button
              size="sm"
              className="text-xs"
              onClick={onSaveDefinitions}
              disabled={savingPlaceholders}
            >
              {savingPlaceholders ? (
                <Loader2 className="h-3 w-3 animate-spin mr-1" />
              ) : (
                <Save className="h-3 w-3 mr-1" />
              )}
              Save
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
