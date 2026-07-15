"use client";

import { Button } from "@/components/ui/button";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDown } from "lucide-react";
import type { PromptKind } from "@/lib/db/schema/prompt-registry";
import {
  CORE_PROMPT_KINDS,
  UTILITY_PROMPT_KINDS,
  KIND_LABELS,
  isUtilityKind,
} from "@/lib/prompts/kinds";

export interface PromptKindNavProps {
  value: PromptKind;
  onValueChange(kind: PromptKind): void;
}

export function PromptKindNav({ value, onValueChange }: PromptKindNavProps) {
  const utility = isUtilityKind(value);
  return (
    <TabsList className="flex-wrap h-auto gap-1">
      {CORE_PROMPT_KINDS.map((kind) => (
        <TabsTrigger key={kind} value={kind}>
          {KIND_LABELS[kind]}
        </TabsTrigger>
      ))}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant={utility ? "secondary" : "ghost"}
            size="sm"
          >
            {utility ? KIND_LABELS[value] : "Más"}
            <ChevronDown className="ml-1 h-3 w-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {UTILITY_PROMPT_KINDS.map((kind) => (
            <DropdownMenuItem key={kind} onSelect={() => onValueChange(kind)}>
              {KIND_LABELS[kind]}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </TabsList>
  );
}
