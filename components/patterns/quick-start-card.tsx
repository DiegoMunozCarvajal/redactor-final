"use client";

import { BookOpen } from "lucide-react";
import { CreateProjectDialog } from "@/components/projects/create-project-dialog";

interface QuickStartCardProps {
  templates: { id: string; name: string; status: string; eligibleForProjects?: boolean }[];
  onOpenChange?: (open: boolean) => void;
}

export function QuickStartCard({ templates, onOpenChange }: QuickStartCardProps) {
  return (
    <CreateProjectDialog
      templates={templates}
      onOpenChange={onOpenChange}
      trigger={
        <button className="rounded-lg border bg-card p-6 hover:border-brand-200 dark:hover:border-brand-700 transition-all duration-200 h-full flex flex-col items-center justify-center text-center gap-3 w-full cursor-pointer">
          <div className="h-10 w-10 rounded-full bg-brand-50 dark:bg-brand-900/30 flex items-center justify-center">
            <BookOpen className="h-5 w-5 text-brand-500" />
          </div>
          <div>
            <p className="font-medium text-sm">New Book</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Start from a template
            </p>
          </div>
        </button>
      }
    />
  );
}
