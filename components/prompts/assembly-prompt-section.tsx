"use client";

import { useState } from "react";
import { AlertCircle, ArrowDown, Eye, GitMerge, Loader2, Play, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type AssemblyPromptSource = "run-override" | "project-binding" | "global-default";

export interface AssemblyPromptRevisionOption {
  id: string;
  name: string;
  versionLabel: string;
  revisionNumber: number;
  systemTemplate: string;
  userTemplate: string;
  requiredMarkers: string[];
  outputContract: string | null;
}

export interface EffectiveAssemblyPrompt extends AssemblyPromptRevisionOption {
  source: AssemblyPromptSource;
}

export interface AssemblyPipelineData {
  planner: EffectiveAssemblyPrompt | null;
  assembler: EffectiveAssemblyPrompt | null;
  plannerRevisions: AssemblyPromptRevisionOption[];
  assemblyRevisions: AssemblyPromptRevisionOption[];
}

interface DefinitionSummary {
  id: string;
  name: string;
  defaultRevisionId: string | null;
}

interface RevisionResponse {
  id: string;
  versionLabel: string;
  revisionNumber: number;
  systemTemplate: string;
  userTemplate: string;
  requiredMarkers: string[];
  outputContract: string | null;
}

interface BindingResponse {
  kind: string;
  promptRevisionId: string;
}

interface KindRegistry {
  defaultRevisionId: string | null;
  revisions: AssemblyPromptRevisionOption[];
}

async function fetchJson<T>(fetcher: typeof fetch, url: string): Promise<T> {
  const response = await fetcher(url);
  if (!response.ok) {
    throw new Error(`Request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}

async function loadKindRegistry(
  kind: "assembly-planner" | "assembly",
  fetcher: typeof fetch,
): Promise<KindRegistry> {
  const definitions = await fetchJson<DefinitionSummary[]>(
    fetcher,
    `/api/prompt-definitions?kind=${encodeURIComponent(kind)}`,
  );
  const revisionGroups = await Promise.all(
    definitions.map(async (definition) => {
      const revisions = await fetchJson<RevisionResponse[]>(
        fetcher,
        `/api/prompt-definitions/${definition.id}/revisions`,
      );
      return revisions.map((revision) => ({
        ...revision,
        name: definition.name,
      }));
    }),
  );

  return {
    defaultRevisionId:
      definitions.find((definition) => definition.defaultRevisionId)?.defaultRevisionId ?? null,
    revisions: revisionGroups.flat(),
  };
}

function resolveEffectivePrompt(
  registry: KindRegistry,
  bindingRevisionId: string | undefined,
): EffectiveAssemblyPrompt | null {
  const effectiveRevisionId = bindingRevisionId ?? registry.defaultRevisionId;
  if (!effectiveRevisionId) return null;

  const revision = registry.revisions.find((item) => item.id === effectiveRevisionId);
  if (!revision) {
    throw new Error(`Configured revision ${effectiveRevisionId} is unavailable`);
  }

  return {
    ...revision,
    source: bindingRevisionId ? "project-binding" : "global-default",
  };
}

export async function loadAssemblyPipelineData(
  projectId: string,
  fetcher: typeof fetch = fetch,
): Promise<AssemblyPipelineData> {
  try {
    const [bindings, plannerRegistry, assemblyRegistry] = await Promise.all([
      fetchJson<BindingResponse[]>(fetcher, `/api/projects/${projectId}/prompt-bindings`),
      loadKindRegistry("assembly-planner", fetcher),
      loadKindRegistry("assembly", fetcher),
    ]);
    const bindingByKind = new Map(
      bindings.map((binding) => [binding.kind, binding.promptRevisionId]),
    );

    return {
      planner: resolveEffectivePrompt(
        plannerRegistry,
        bindingByKind.get("assembly-planner"),
      ),
      assembler: resolveEffectivePrompt(
        assemblyRegistry,
        bindingByKind.get("assembly"),
      ),
      plannerRevisions: plannerRegistry.revisions,
      assemblyRevisions: assemblyRegistry.revisions,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown error";
    throw new Error(`Could not load assembly prompt registry: ${detail}`);
  }
}

interface Props {
  planner: EffectiveAssemblyPrompt | null;
  assembler: EffectiveAssemblyPrompt | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onAssemble?: () => void;
  assembling?: boolean;
  canAssemble: boolean;
}

function sourceLabel(source: AssemblyPromptSource): string {
  if (source === "run-override") return "Run override";
  return source === "project-binding" ? "Project binding" : "Global default";
}

function PromptStage({
  label,
  prompt,
  loading,
  onView,
}: {
  label: "Planner" | "Assembler";
  prompt: EffectiveAssemblyPrompt | null;
  loading: boolean;
  onView: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-3">
      <div className="min-w-0">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        {loading ? (
          <p className="mt-1 text-sm text-muted-foreground">Loading effective revision…</p>
        ) : prompt ? (
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">
              {prompt.name} v{prompt.versionLabel}
            </span>
            <Badge variant="secondary" className="h-5 text-[10px]">
              {sourceLabel(prompt.source)}
            </Badge>
          </div>
        ) : (
          <p className="mt-1 text-sm text-destructive">No effective revision configured</p>
        )}
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="shrink-0 text-xs"
        aria-label={`View ${label.toLowerCase()} prompt`}
        disabled={!prompt || loading}
        onClick={onView}
      >
        <Eye className="mr-1 h-3 w-3" />
        View prompt
      </Button>
    </div>
  );
}

export function AssemblyPromptSection({
  planner,
  assembler,
  loading,
  error,
  onRetry,
  onAssemble,
  assembling = false,
  canAssemble,
}: Props) {
  const [preview, setPreview] = useState<{
    stage: "Planner" | "Assembler";
    prompt: EffectiveAssemblyPrompt;
  } | null>(null);

  return (
    <div className="mb-8">
      <h2 className="mb-3 text-sm font-medium text-muted-foreground">Assembly pipeline</h2>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <GitMerge className="h-4 w-4" />
            Planning → Assembly
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <PromptStage
            label="Planner"
            prompt={planner}
            loading={loading}
            onView={() => planner && setPreview({ stage: "Planner", prompt: planner })}
          />
          <div className="flex justify-center" aria-hidden="true">
            <ArrowDown className="h-4 w-4 text-muted-foreground" />
          </div>
          <PromptStage
            label="Assembler"
            prompt={assembler}
            loading={loading}
            onView={() => assembler && setPreview({ stage: "Assembler", prompt: assembler })}
          />

          {error && (
            <div
              role="alert"
              className="flex items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2"
            >
              <p className="flex items-center gap-2 text-xs text-destructive">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                {error}
              </p>
              <Button type="button" variant="outline" size="sm" onClick={onRetry}>
                <RefreshCw className="mr-1 h-3 w-3" />
                Retry
              </Button>
            </div>
          )}

          <div className="flex items-center justify-between gap-3 pt-2">
            <p className="text-xs text-muted-foreground">
              {canAssemble
                ? "Planner runs first; assembler consumes its structured plan."
                : "Generate at least one fragment before assembling."}
            </p>
            {onAssemble && (
              <Button
                type="button"
                size="sm"
                className="text-xs"
                onClick={onAssemble}
                disabled={
                  assembling || loading || Boolean(error) || !planner || !assembler || !canAssemble
                }
              >
                {assembling ? (
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                ) : (
                  <Play className="mr-1 h-3 w-3" />
                )}
                {assembling ? "Assembling" : "Assemble"}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Dialog open={preview !== null} onOpenChange={(open) => !open && setPreview(null)}>
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {preview?.stage}: {preview?.prompt.name} v{preview?.prompt.versionLabel}
            </DialogTitle>
            <DialogDescription>
              Read-only effective revision. Global editing remains in /generation.
            </DialogDescription>
          </DialogHeader>
          {preview && (
            <div className="space-y-4 text-sm">
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">System template</p>
                <pre className="whitespace-pre-wrap rounded-md border bg-muted/30 p-3 text-xs">
                  {preview.prompt.systemTemplate}
                </pre>
              </div>
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">User template</p>
                <pre className="whitespace-pre-wrap rounded-md border bg-muted/30 p-3 text-xs">
                  {preview.prompt.userTemplate}
                </pre>
              </div>
              {preview.prompt.requiredMarkers.length > 0 && (
                <div>
                  <p className="mb-1 text-xs font-medium text-muted-foreground">Required markers</p>
                  <div className="flex flex-wrap gap-1">
                    {preview.prompt.requiredMarkers.map((marker) => (
                      <Badge key={marker} variant="outline" className="font-mono text-[10px]">
                        {marker}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              {preview.prompt.outputContract && (
                <div>
                  <p className="mb-1 text-xs font-medium text-muted-foreground">Output contract</p>
                  <pre className="whitespace-pre-wrap rounded-md border bg-muted/30 p-3 text-xs">
                    {preview.prompt.outputContract}
                  </pre>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
