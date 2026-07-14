"use client";

import { Badge } from "@/components/ui/badge";
import { computeStaleness, type StalenessStatus } from "@/lib/editorial-brief/staleness";

interface EditorialVersionBadgeProps {
  generationMetadata?: {
    editorialBriefId?: string | null;
    editorialBriefVersion?: number | null;
    editorialBriefHash?: string | null;
  } | null;
  activeBrief: { id: string; version: number; hash: string } | null;
}

/**
 * Renders a badge showing the editorial brief version used for a generation.
 *
 * - No activeBrief → nothing (project has no editorial brief feature)
 * - No generation metadata → "Sin brief" gray badge (legacy)
 * - Matching hash → "Brief v{N}" green badge
 * - Different hash → "Brief v{N} (desactualizado)" amber badge
 * - Invalid/deleted → "Brief eliminado" red badge
 */
export function EditorialVersionBadge({
  generationMetadata,
  activeBrief,
}: EditorialVersionBadgeProps) {
  if (!activeBrief) {
    // Project has never had editorial briefs — nothing to show
    return null;
  }

  const status = computeStaleness(generationMetadata, activeBrief);

  switch (status) {
    case "current":
      return (
        <Badge className="bg-success/10 text-success border-success/20 text-[10px] h-4 px-1.5">
          Brief v{generationMetadata?.editorialBriefVersion ?? activeBrief.version}
        </Badge>
      );
    case "stale":
      return (
        <Badge className="bg-warning/10 text-warning border-warning/20 text-[10px] h-4 px-1.5">
          Brief v{generationMetadata?.editorialBriefVersion ?? "?"} (desactualizado)
        </Badge>
      );
    case "legacy":
      return (
        <Badge variant="secondary" className="text-[10px] h-4 px-1.5">
          Sin brief
        </Badge>
      );
    case "invalid":
      return (
        <Badge variant="destructive" className="text-[10px] h-4 px-1.5">
          Brief eliminado
        </Badge>
      );
  }
}

/**
 * Returns a CSS class for a stale indicator dot.
 */
export function getStalenessIndicator(
  generationMetadata?: {
    editorialBriefId?: string | null;
    editorialBriefVersion?: number | null;
    editorialBriefHash?: string | null;
  } | null,
  activeBrief?: { id: string; version: number; hash: string } | null,
): {
  show: boolean;
  status: StalenessStatus;
} {
  if (!activeBrief) return { show: false, status: "current" };
  const status = computeStaleness(generationMetadata, activeBrief);
  return {
    show: status === "stale",
    status,
  };
}
