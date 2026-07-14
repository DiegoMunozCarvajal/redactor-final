"use client";

import { Button } from "@/components/ui/button";
import { ResourceCard } from "@/components/patterns/resource-card";
import { EmptyState } from "@/components/patterns/empty-state";
import { Plus, FileText } from "lucide-react";
import type { PromptKind } from "@/lib/db/schema/prompt-registry";
import { promptKindValues } from "@/lib/db/schema/prompt-registry";

export const KIND_LABELS: Record<PromptKind, string> = {
  "generation-system": "Sistema",
  "meta-template": "Meta-prompt",
  "assembly-planner": "Planificador",
  assembly: "Ensamblaje",
  critique: "Crítica",
  corrector: "Corrector",
  title: "Título",
  "placeholder-fill": "Placeholders",
  "editorial-brief-extractor": "Extractor editorial",
};

export interface PromptDefinitionSummary {
  id: string;
  name: string;
  description: string | null;
  kind: PromptKind;
  archivedAt: string | null;
  latestRevision: {
    id: string;
    versionLabel: string;
    revisionNumber: number;
  } | null;
  defaultRevisionId: string | null;
}

export interface PromptDefinitionListProps {
  kind: PromptKind;
  definitions: PromptDefinitionSummary[];
  currentDefaultRevisionId?: string | null;
  onCreate(): void;
}

export function PromptDefinitionList({
  kind,
  definitions,
  currentDefaultRevisionId,
  onCreate,
}: PromptDefinitionListProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {definitions.length} definición{definitions.length !== 1 ? "es" : ""}
        </p>
        <Button variant="outline" size="sm" onClick={onCreate}>
          <Plus className="h-4 w-4 mr-1" />Nueva
        </Button>
      </div>

      {definitions.length === 0 ? (
        <EmptyState
          icon={FileText}
          title={`Sin prompts de ${KIND_LABELS[kind].toLowerCase()}`}
          description="Crea la primera definición para este tipo de prompt."
        />
      ) : (
        definitions.map((def) => (
          <ResourceCard
            key={def.id}
            href={`/generation/${def.id}`}
            title={def.name}
            description={
              def.description ??
              (def.latestRevision
                ? `v${def.latestRevision.versionLabel} · revisión #${def.latestRevision.revisionNumber}`
                : "Sin revisiones")
            }
          >
            <div className="flex items-center gap-2 mt-1">
              {def.latestRevision && (
                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                  v{def.latestRevision.versionLabel}
                </span>
              )}
              {currentDefaultRevisionId &&
                def.latestRevision &&
                currentDefaultRevisionId === def.latestRevision.id && (
                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-brand-100 text-brand-700 dark:bg-brand-900 dark:text-brand-300">
                    default
                  </span>
                )}
              {def.archivedAt && (
                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-destructive/10 text-destructive">
                  archivada
                </span>
              )}
            </div>
          </ResourceCard>
        ))
      )}
    </div>
  );
}
