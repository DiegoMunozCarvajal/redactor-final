"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Loader2, Play, RotateCcw } from "lucide-react";

export function GenerateChapterButton({
  projectId,
  chapterId,
  hasGeneration,
}: {
  projectId: string;
  chapterId: string;
  hasGeneration: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleGenerate() {
    setLoading(true);
    const res = await fetch(
      `/api/projects/${projectId}/chapters/${chapterId}/generate`,
      { method: "POST" },
    );
    if (res.ok) {
      router.refresh();
    } else {
      const data = await res.json();
      alert(data.error ?? "Error generating chapter");
    }
    setLoading(false);
  }

  return (
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
  );
}
