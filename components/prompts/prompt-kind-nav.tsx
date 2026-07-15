"use client";

import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { PromptKind } from "@/lib/db/schema/prompt-registry";
import { KIND_LABELS, ALL_PROMPT_KINDS } from "@/lib/prompts/kinds";

export interface PromptKindNavProps {
  value: PromptKind;
  onValueChange(kind: PromptKind): void;
}

export function PromptKindNav({ value, onValueChange }: PromptKindNavProps) {
  return (
    <TabsList className="flex-wrap h-auto gap-1">
      {ALL_PROMPT_KINDS.map((kind) => (
        <TabsTrigger key={kind} value={kind}>
          {KIND_LABELS[kind]}
        </TabsTrigger>
      ))}
    </TabsList>
  );
}
