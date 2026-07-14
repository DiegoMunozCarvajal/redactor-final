"use client";

import { useEffect, useState } from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Settings2 } from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RevisionInfo {
  id: string;
  versionLabel: string;
  revisionNumber: number;
  name: string;
}

interface BindingEntry {
  kind: string;
  label: string;
  effectiveRevision: RevisionInfo | null;
  isOverride: boolean;
}

export interface PromptBindingsCardProps {
  projectId: string;
  className?: string;
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

const KIND_LABELS: Record<string, string> = {
  "generation-system": "Generation System",
  "assembly-planner": "Assembly Planner",
  "assembly": "Assembly",
  "critique": "Critique",
  "corrector": "Corrector",
  "title": "Title",
  "placeholder-fill": "Placeholder Fill",
  "editorial-brief-extractor": "Editorial Brief Extractor",
};

const PROJECT_KINDS = Object.keys(KIND_LABELS);

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PromptBindingsCard({
  projectId,
  className,
}: PromptBindingsCardProps) {
  const [bindings, setBindings] = useState<BindingEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch(
          `/api/projects/${projectId}/prompt-bindings`,
        );
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) setBindings(data);
          if (!cancelled) setLoading(false);
          return;
        }
      } catch {
        // API not available — fall through to fallback
      }

      // Show all kinds with unresolved revisions. The prompt-defaults API
      // requires the prompt_defaults table (migration 20260714000002).
      // When the table exists, each row resolves to its effective revision.
      const fallback = PROJECT_KINDS.map((kind) => ({
        kind,
        label: KIND_LABELS[kind] ?? kind,
        effectiveRevision: null,
        isOverride: false,
      }));
      if (!cancelled) setBindings(fallback);
      if (!cancelled) setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  if (loading) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Settings2 className="h-4 w-4" />
            Effective Prompts
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-8 w-full animate-pulse bg-muted rounded-md" />
          ))}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2">
          <Settings2 className="h-4 w-4" />
          Effective Prompts
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {bindings.map((binding) => (
          <div
            key={binding.kind}
            className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
          >
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-medium truncate">{binding.label}</span>
              {binding.isOverride && (
                <Badge variant="outline" className="shrink-0 text-[10px] h-4 px-1.5">
                  Override
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0 ml-2">
              {binding.effectiveRevision ? (
                <span className="text-xs text-muted-foreground">
                  {binding.effectiveRevision.name}{" "}
                  <Badge variant="secondary" className="text-[10px] h-4 px-1.5">
                    v{binding.effectiveRevision.revisionNumber}
                  </Badge>
                </span>
              ) : (
                <span className="text-xs text-destructive">
                  No revision configured
                </span>
              )}
            </div>
          </div>
        ))}
        {bindings.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-4">
            No prompt bindings configured. Defaults will be used for all stages.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
