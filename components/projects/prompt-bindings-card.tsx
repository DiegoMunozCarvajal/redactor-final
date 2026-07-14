"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Settings2, X, ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RevisionEntry {
  id: string;
  versionLabel: string;
  name: string;
}

interface BindingEntry {
  kind: string;
  label: string;
  effectiveRevision: RevisionEntry | null;
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
  const [expandedKind, setExpandedKind] = useState<string | null>(null);
  const [availableRevisions, setAvailableRevisions] = useState<RevisionEntry[]>([]);
  const [loadingRevisions, setLoadingRevisions] = useState(false);
  const [saving, setSaving] = useState(false);

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
      const defaultsMap = new Map<string, RevisionEntry>();
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

  async function loadRevisions(kind: string) {
    setLoadingRevisions(true);
    try {
      // Fetch definitions for this kind, then revisions for each definition
      const defsRes = await fetch(`/api/prompt-definitions?kind=${encodeURIComponent(kind)}`);
      if (!defsRes.ok) { setAvailableRevisions([]); return; }
      const defs: { id: string; name: string; latestRevision: { id: string; versionLabel: string } | null }[] = await defsRes.json();

      const revisions: RevisionEntry[] = [];
      for (const def of defs) {
        if (def.latestRevision) {
          revisions.push({
            id: def.latestRevision.id,
            versionLabel: def.latestRevision.versionLabel,
            name: def.name,
          });
        }
      }
      setAvailableRevisions(revisions);
    } catch {
      setAvailableRevisions([]);
    } finally {
      setLoadingRevisions(false);
    }
  }

  function toggleExpand(kind: string) {
    if (expandedKind === kind) {
      setExpandedKind(null);
    } else {
      setExpandedKind(kind);
      loadRevisions(kind);
    }
  }

  async function setOverride(kind: string, revisionId: string) {
    setSaving(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/prompt-bindings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, promptRevisionId: revisionId }),
      });
      if (res.ok) {
        toast.success(`Override set for ${KIND_LABELS[kind] ?? kind}`);
        setExpandedKind(null);
        load();
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error ?? "Failed to set override");
      }
    } catch {
      toast.error("Network error");
    } finally {
      setSaving(false);
    }
  }

  async function clearOverride(kind: string) {
    setSaving(true);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/prompt-bindings?kind=${encodeURIComponent(kind)}`,
        { method: "DELETE" },
      );
      if (res.ok) {
        toast.success(`Override cleared for ${KIND_LABELS[kind] ?? kind}`);
        setExpandedKind(null);
        load();
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error ?? "Failed to clear override");
      }
    } catch {
      toast.error("Network error");
    } finally {
      setSaving(false);
    }
  }

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
      <CardContent className="space-y-1">
        {bindings.map((binding) => (
          <div key={binding.kind}>
            <button
              type="button"
              className="flex items-center justify-between rounded-md border px-3 py-2 text-sm w-full hover:bg-muted/50 transition-colors text-left"
              onClick={() => toggleExpand(binding.kind)}
              disabled={saving}
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
              <div className="flex items-center gap-1 shrink-0 ml-2">
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
                {expandedKind === binding.kind ? (
                  <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                )}
              </div>
            </button>

            {/* Inline override picker */}
            {expandedKind === binding.kind && (
              <div className="border border-t-0 rounded-b-md px-3 py-3 space-y-2 bg-muted/30">
                {loadingRevisions ? (
                  <p className="text-xs text-muted-foreground">Loading revisions…</p>
                ) : availableRevisions.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No revisions available for this kind.
                  </p>
                ) : (
                  <Select
                    value={binding.effectiveRevision?.id ?? ""}
                    onValueChange={(v) => setOverride(binding.kind, v)}
                    disabled={saving}
                  >
                    <SelectTrigger className="w-full h-8 text-xs">
                      <SelectValue placeholder="Select a revision…" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableRevisions.map((rev) => (
                        <SelectItem key={rev.id} value={rev.id} className="text-xs">
                          {rev.name} ({rev.versionLabel})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}

                {binding.isOverride && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs text-destructive hover:text-destructive w-full"
                    onClick={() => clearOverride(binding.kind)}
                    disabled={saving}
                  >
                    <X className="h-3 w-3 mr-1" />
                    Clear override (use global default)
                  </Button>
                )}
              </div>
            )}
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
