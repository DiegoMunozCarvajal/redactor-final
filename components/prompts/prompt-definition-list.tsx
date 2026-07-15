"use client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ResourceCard } from "@/components/patterns/resource-card";
import { EmptyState } from "@/components/patterns/empty-state";
import { Plus, FileText } from "lucide-react";
import type { PromptKind } from "@/lib/db/schema/prompt-registry";
import { KIND_LABELS } from "@/lib/prompts/kinds";
import type { DefinitionSummary } from "@/lib/prompts/admin-types";

export { KIND_LABELS };
export type { DefinitionSummary as PromptDefinitionSummary };

export interface PromptDefinitionListProps {
  kind: PromptKind;
  definitions: DefinitionSummary[];
  onCreate(): void;
}

export function PromptDefinitionList({
  kind,
  definitions,
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
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              {def.latestRevision && (
                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                  v{def.latestRevision.versionLabel}
                </span>
              )}
              {def.defaultVersionLabel && (
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-auto">
                  Default: v{def.defaultVersionLabel}
                </Badge>
              )}
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-auto">
                {def.bindingCount} proyecto{def.bindingCount !== 1 ? "s" : ""}
              </Badge>
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-auto">
                {def.executionCount} ejecucione{def.executionCount !== 1 ? "s" : ""}
              </Badge>
              {def.archivedAt && (
                <Badge variant="destructive" className="text-[10px] px-1.5 py-0 h-auto">
                  Archivada
                </Badge>
              )}
            </div>
          </ResourceCard>
        ))
      )}
    </div>
  );
}
