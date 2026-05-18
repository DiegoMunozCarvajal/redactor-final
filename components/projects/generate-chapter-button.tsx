"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Play, RotateCcw } from "lucide-react";
import { toast } from "sonner";

// Keep in sync with lib/ai/providers.ts AVAILABLE_MODELS
const MODELS = [
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
  { id: "claude-opus-4-7", label: "Claude Opus 4.7" },
  { id: "gpt-5.4-mini", label: "GPT 5.4 Mini" },
  { id: "gpt-5.4", label: "GPT 5.4" },
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
  { id: "deepseek-v4-flash", label: "DeepSeek V4 Flash" },
  { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro" },
];

export function GenerateChapterButton({
  projectId,
  chapterId,
  hasGeneration,
  onGenerationStarted,
}: {
  projectId: string;
  chapterId: string;
  hasGeneration: boolean;
  onGenerationStarted: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [model, setModel] = useState("deepseek-v4-flash");

  async function handleGenerate() {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/chapters/${chapterId}/generate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model }),
        },
      );
      if (res.ok) {
        onGenerationStarted();
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? "Error generating chapter");
      }
    } catch {
      toast.error("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Select value={model} onValueChange={setModel}>
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
        onClick={handleGenerate}
        disabled={loading}
        variant={hasGeneration ? "outline" : "default"}
        size="sm"
      >
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin mr-1" />
        ) : hasGeneration ? (
          <RotateCcw className="h-4 w-4 mr-1" />
        ) : (
          <Play className="h-4 w-4 mr-1" />
        )}
        {hasGeneration ? "Regenerar" : "Generar"}
      </Button>
    </div>
  );
}
