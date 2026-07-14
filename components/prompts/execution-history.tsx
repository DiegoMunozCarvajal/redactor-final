"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { enUS } from "date-fns/locale";
import { Copy, Check } from "lucide-react";
import { useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExecutionEvent {
  id: string;
  status: "started" | "completed" | "failed";
  model: string;
  provider?: string | null;
  usedAt: string; // ISO date
  error?: string | null;
  stage?: string | null;
  kind?: string | null;
}

export interface ExecutionHistoryProps {
  executions: ExecutionEvent[];
  title?: string;
  emptyMessage?: string;
  className?: string;
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

const STATUS_LABELS: Record<ExecutionEvent["status"], string> = {
  started: "Running",
  completed: "Completed",
  failed: "Failed",
};

const STATUS_VARIANTS: Record<
  ExecutionEvent["status"],
  "default" | "secondary" | "destructive" | "outline"
> = {
  started: "secondary",
  completed: "default",
  failed: "destructive",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      className="ml-auto shrink-0 text-muted-foreground hover:text-foreground transition-colors"
      onClick={async (e) => {
        e.stopPropagation();
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      title="Copy execution ID"
    >
      {copied ? (
        <Check className="h-3 w-3 text-green-500" />
      ) : (
        <Copy className="h-3 w-3" />
      )}
    </button>
  );
}

export function ExecutionHistory({
  executions,
  title = "Prompt History",
  emptyMessage = "No executions recorded.",
  className,
}: ExecutionHistoryProps) {
  if (executions.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">{emptyMessage}</p>
    );
  }

  return (
    <div className={cn("space-y-1.5", className)}>
      {title && (
        <h4 className="text-sm font-semibold text-muted-foreground mb-2">
          {title}
        </h4>
      )}
      {executions.map((exec) => (
        <div
          key={exec.id}
          className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs bg-card"
        >
          <Badge
            variant={STATUS_VARIANTS[exec.status]}
            className="shrink-0 text-[10px] h-4 px-1.5"
          >
            {STATUS_LABELS[exec.status]}
          </Badge>
          <span className="text-muted-foreground shrink-0">{exec.model}</span>
          {exec.provider && (
            <span className="text-muted-foreground/60 shrink-0">
              ({exec.provider})
            </span>
          )}
          <code className="font-mono text-[10px] text-muted-foreground/70 truncate">
            {exec.id.slice(0, 8)}...
          </code>
          {exec.error && (
            <span className="text-destructive truncate" title={exec.error}>
              {exec.error.slice(0, 80)}
            </span>
          )}
          <span className="ml-auto text-muted-foreground/60 shrink-0">
            {formatDistanceToNow(new Date(exec.usedAt), {
              addSuffix: true,
              locale: enUS,
            })}
          </span>
          <CopyButton value={exec.id} />
        </div>
      ))}
    </div>
  );
}
