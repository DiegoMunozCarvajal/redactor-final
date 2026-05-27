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

import { MODEL_OPTIONS, DEFAULT_GENERATION_MODEL } from "@/lib/ai/providers";

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
  const [model, setModel] = useState(DEFAULT_GENERATION_MODEL);

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
          {MODEL_OPTIONS.map((m) => (
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
        {hasGeneration ? "Regenerate" : "Generate"}
      </Button>
    </div>
  );
}
