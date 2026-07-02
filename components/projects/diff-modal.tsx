"use client";

import { useCallback, useRef, type RefObject } from "react";
import { diffWords, type Change } from "diff";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface DiffModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  originalTitle: string;
  correctedTitle: string;
  originalText: string;
  correctedText: string;
}

function renderDiff(changes: Change[], side: "original" | "corrected") {
  return changes.map((part, i) => {
    if (part.added && side === "corrected") {
      return (
        <span
          key={i}
          className="bg-green-200 text-green-900 dark:bg-green-900/40 dark:text-green-300"
        >
          {part.value}
        </span>
      );
    }
    if (part.removed && side === "original") {
      return (
        <span
          key={i}
          className="bg-red-200 text-red-900 line-through dark:bg-red-900/40 dark:text-red-300"
        >
          {part.value}
        </span>
      );
    }
    if (!part.added && !part.removed) {
      return <span key={i}>{part.value}</span>;
    }
    // Hide removed parts in corrected panel, added parts in original panel
    return null;
  });
}

function DiffPanel({
  title,
  changes,
  side,
  scrollRef,
  onScroll,
}: {
  title: string;
  changes: Change[];
  side: "original" | "corrected";
  scrollRef?: RefObject<HTMLDivElement | null>;
  onScroll?: (scrollTop: number) => void;
}) {
  const localRef = useRef<HTMLDivElement>(null);
  const ref = scrollRef ?? localRef;

  const handleScroll = useCallback(() => {
    if (onScroll && ref.current) {
      onScroll(ref.current.scrollTop);
    }
  }, [onScroll, ref]);

  return (
    <div className="flex-1 min-w-0">
      <h3 className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">
        {title}
      </h3>
      <div
        ref={ref}
        onScroll={handleScroll}
        className="h-[70vh] overflow-auto rounded-md border bg-muted/20 p-4 text-sm leading-relaxed whitespace-pre-wrap"
      >
        {renderDiff(changes, side)}
      </div>
    </div>
  );
}

export function DiffModal({
  open,
  onOpenChange,
  originalTitle,
  correctedTitle,
  originalText,
  correctedText,
}: DiffModalProps) {
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const syncing = useRef(false);

  const changes = diffWords(originalText, correctedText);

  const syncScroll = useCallback(
    (source: "left" | "right") => (scrollTop: number) => {
      if (syncing.current) return;
      syncing.current = true;
      const target = source === "left" ? rightRef.current : leftRef.current;
      if (target) {
        target.scrollTop = scrollTop;
      }
      requestAnimationFrame(() => {
        syncing.current = false;
      });
    },
    [],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] w-full max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="text-sm">
            Compare: {originalTitle} → {correctedTitle}
          </DialogTitle>
        </DialogHeader>
        <div className="flex gap-4">
          <DiffPanel
            title="Original"
            changes={changes}
            side="original"
            scrollRef={leftRef}
            onScroll={syncScroll("left")}
          />
          <DiffPanel
            title="Corrected"
            changes={changes}
            side="corrected"
            scrollRef={rightRef}
            onScroll={syncScroll("right")}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
