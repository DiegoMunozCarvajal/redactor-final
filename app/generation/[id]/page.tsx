"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/patterns/page-header";
import { LoadingSkeleton } from "@/components/patterns/loading-skeleton";
import { PromptRevisionEditor } from "@/components/prompts/prompt-revision-editor";
import type { RevisionSummary } from "@/components/prompts/prompt-revision-editor";
import { KIND_LABELS } from "@/components/prompts/prompt-definition-list";
import type { PromptKind } from "@/lib/db/schema/prompt-registry";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";

interface DefinitionDetail {
  id: string;
  name: string;
  kind: PromptKind;
  description: string | null;
  archivedAt: string | null;
  revisions: RevisionSummary[];
}

export default function GenerationDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [definition, setDefinition] = useState<DefinitionDetail | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchDefinition = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch(`/api/prompt-definitions/${params.id}`, { signal });
      if (!res.ok) {
        router.push("/generation");
        return;
      }
      setDefinition(await res.json());
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      toast.error("Could not connect to server");
    }
    setLoading(false);
  }, [params.id, router]);

  useEffect(() => {
    const controller = new AbortController();
    fetchDefinition(controller.signal);
    return () => controller.abort();
  }, [fetchDefinition]);

  if (loading) return <LoadingSkeleton />;
  if (!definition) return null;

  const kindLabel = KIND_LABELS[definition.kind] ?? definition.kind;

  return (
    <div className="space-y-6">
      <PageHeader
        title={definition.name}
        subtitle={
          definition.description
            ? `${kindLabel} · ${definition.description}`
            : kindLabel
        }
      >
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => router.push("/generation")}>
            <ArrowLeft className="h-4 w-4 mr-2" />Volver
          </Button>
        </div>
      </PageHeader>

      {definition.archivedAt && (
        <div className="px-4 py-3 bg-amber-50 border border-amber-200 rounded text-sm text-amber-800 dark:bg-amber-950 dark:border-amber-800 dark:text-amber-200">
          Esta definición está archivada desde {definition.archivedAt.slice(0, 10)}.
        </div>
      )}

      <PromptRevisionEditor
        definitionId={definition.id}
        definitionName={definition.name}
        kind={definition.kind}
        revisions={definition.revisions}
        onRevisionCreated={() => fetchDefinition()}
      />
    </div>
  );
}
