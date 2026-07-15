"use client";

import { diffLines } from "diff";

export function RevisionDiff({ before, after }: { before: string; after: string }) {
  const changes = diffLines(before, after);
  return (
    <pre className="whitespace-pre-wrap rounded border p-3 text-xs">
      {changes.map((part, index) => (
        <span
          key={`${index}-${part.value.length}`}
          data-change={part.added ? "added" : part.removed ? "removed" : "same"}
          className={
            part.added
              ? "bg-green-100 dark:bg-green-950"
              : part.removed
                ? "bg-red-100 line-through dark:bg-red-950"
                : ""
          }
        >
          {part.value}
        </span>
      ))}
    </pre>
  );
}
