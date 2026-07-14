"use client";

import { useEffect, useState, useCallback } from "react";
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

interface BindingEntry {
  kind: string;
  label: string;
  effectiveRevision: {
    id: string;
    versionLabel: string;
    name: string;
  } | null;
  isOverride: boolean;
}

interface PromptBindingsCardProps {
  projectId: string;
  className?: string;
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

const KIND_LABELS: Record<string, string> = {
  "generation-system": "Generation System",
  "assembly-planner": "Assembly Planner",
  assembly: "Assembly",
  critique: "Critique",
  corrector: "Corrector",
  title: "Title",
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

  const load = useCallback(async () => {
    try {
      // Fetch project overrides
      const overridesRes = await fetch(
        `/api/projects/${projectId}/prompt-bindings`,
      );
      const overrides: { kind: string; promptRevisionId: string; versionLabel: string; definitionName: string }[] =
        overridesRes.ok ? await overridesRes.json() : [];
      const overrideMap = new Map(overrides.map((o) => [o.kind, o]));

      // Fetch global defaults for all kinds
      const defaultsMap = new Map<
        string,
        { id: string; versionLabel: string; name: string }
      >();
      await Promise.all(
        PROJECT_KINDS.map(async (kind) => {
          try {
            const res = await fetch(
              `/api/prompt-defaults/${encodeURIComponent(kind)}`,
            );
            if (res.ok) {
              const data = await res.json();
              defaultsMap.set(kind, {
                id: data.id,
                versionLabel: data.versionLabel,
                name: data.name,
              });
            }
          } catch {
            // Default not configured for this kind — skip
          }
        }),
      );

      // Merge: project override > global default > null
      const entries: BindingEntry[] = PROJECT_KINDS.map((kind) => {
        const override = overrideMap.get(kind);
        const def = defaultsMap.get(kind);
        if (override) {
          return {
            kind,
            label: KIND_LABELS[kind] ?? kind,
            effectiveRevision: {
              id: override.promptRevisionId,
              versionLabel: override.versionLabel,
              name: override.definitionName,
            },
            isOverride: true,
          };
        }
        if (def) {
          return {
            kind,
            label: KIND_LABELS[kind] ?? kind,
            effectiveRevision: def,
            isOverride: false,
          };
        }
        return {
          kind,
          label: KIND_LABELS[kind] ?? kind,
          effectiveRevision: null,
          isOverride: false,
        };
      });

      setBindings(entries);
    } catch {
      setBindings(
        PROJECT_KINDS.map((kind) => ({
          kind,
          label: KIND_LABELS[kind] ?? kind,
          effectiveRevision: null,
          isOverride: false,
        })),
      );
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

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
            <div
              key={i}
              className="h-8 w-full animate-pulse bg-muted rounded-md"
            />
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
                <Badge
                  variant="outline"
                  className="shrink-0 text-[10px] h-4 px-1.5"
                >
                  Project override
                </Badge>
              )}
            </div>
            <div className="shrink-0 ml-2">
              {binding.effectiveRevision ? (
                <span className="text-xs text-muted-foreground">
                  {binding.effectiveRevision.name}{" "}
                  <Badge
                    variant="secondary"
                    className="text-[10px] h-4 px-1.5"
                  >
                    {binding.effectiveRevision.versionLabel}
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
            No prompt bindings configured.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
