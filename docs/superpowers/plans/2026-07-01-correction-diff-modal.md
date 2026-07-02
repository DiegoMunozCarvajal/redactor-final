# Correction Diff Modal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current stacked before/after correction diff with a side-by-side modal showing word-level differences (red=deleted, green=added) between original and corrected chapter text.

**Architecture:** New `DiffModal` component using `diff` package for word-level diffing, rendered in a shadcn/ui Dialog with scroll-synced panels. The chapter page finds the original generation from `assemblyVersions` (the next entry after the correction) and passes both texts. The existing `CorrectionDiff` component stays as a collapsible fallback.

**Tech Stack:** React, TypeScript, `diff` npm package, shadcn/ui Dialog, Tailwind CSS

## Global Constraints

- TypeScript strict: no `any`, proper types for all props
- Use existing shadcn/ui Dialog from `components/ui/dialog.tsx`
- Match existing code style: functional components, hooks, Tailwind
- No changes to `CorrectionDiff` component (stays as-is)
- Spanish UI labels (user-facing text in Spanish)

---

### Task 1: Install `diff` package

**Files:**

- Modify: `package.json`

- [ ] **Step 1: Install dependency**

```bash
rtk pnpm add diff
```

- [ ] **Step 2: Install types**

```bash
rtk pnpm add -D @types/diff
```

- [ ] **Step 3: Verify install**

```bash
rtk node -e "const d = require('diff'); console.log(typeof d.diffWords)"
```

Expected: `function`

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: add diff package for word-level diffing"
```

---

### Task 2: Create `DiffModal` component

**Files:**

- Create: `components/projects/diff-modal.tsx`

**Interfaces:**

- Produces: `DiffModal` component — `{ open: boolean; onOpenChange: (open: boolean) => void; originalTitle: string; correctedTitle: string; originalText: string; correctedText: string }`

- [ ] **Step 1: Write the component**

```tsx
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
```

- [ ] **Step 2: TypeScript check**

```bash
rtk pnpm typecheck
```

Expected: no errors related to `diff-modal.tsx`

- [ ] **Step 3: Commit**

```bash
git add components/projects/diff-modal.tsx
git commit -m "feat: add DiffModal component for side-by-side chapter comparison"
```

---

### Task 3: Integrate DiffModal into chapter page

**Files:**

- Modify: `app/projects/[id]/chapters/[chapterId]/page.tsx`

**Interfaces:**

- Consumes: `DiffModal` component from Task 2, `assemblyVersions` already in scope
- Produces: "Compare" button in Assembly Results toolbar, modal on click

- [ ] **Step 1: Add state and import**

At the top of the file (around line 56), add the import:

```tsx
import { DiffModal } from "@/components/projects/diff-modal";
```

After the existing state declarations (around line 183, near `selectedAssemblyGenerationId`), add:

```tsx
const [diffModalOpen, setDiffModalOpen] = useState(false);
```

- [ ] **Step 2: Compute original generation for comparison**

After the `selectedAssemblyVersionNumber` computation (line 866), add:

```tsx
// Find the original text that was corrected.
// assemblyVersions is sorted by completedAt desc (newest first).
// The original is the immediate predecessor of the correction.
const correctionOriginalText =
  selectedAssemblyVersion?.generationMetadata?.type === "correction"
    ? (() => {
        const idx = assemblyVersions.findIndex(
          (g) => g.id === selectedAssemblyVersion.id,
        );
        if (idx < 0) return null;
        const original = assemblyVersions[idx + 1];
        return original?.assembledContent ?? null;
      })()
    : null;
```

- [ ] **Step 3: Add "Compare" button**

In the metadata bar (around line 1392, before the `Button` with `Copy`), add:

```tsx
{
  selectedAssemblyVersion.generationMetadata?.type === "correction" &&
    correctionOriginalText && (
      <Button
        size="sm"
        variant="outline"
        className="h-7 text-xs"
        onClick={() => setDiffModalOpen(true)}
      >
        Compare
      </Button>
    );
}
```

- [ ] **Step 4: Render DiffModal**

After the closing `</div>` of the Assembly Results section (around line 1464), add:

```tsx
{
  correctionOriginalText && selectedAssemblyVersion?.assembledContent && (
    <DiffModal
      open={diffModalOpen}
      onOpenChange={setDiffModalOpen}
      originalTitle={`v${selectedAssemblyVersionNumber - 1}`}
      correctedTitle={`v${selectedAssemblyVersionNumber} (Corrected)`}
      originalText={correctionOriginalText}
      correctedText={selectedAssemblyVersion.assembledContent}
    />
  );
}
```

- [ ] **Step 5: TypeScript check**

```bash
rtk pnpm typecheck
```

Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add app/projects/\[id\]/chapters/\[chapterId\]/page.tsx
git commit -m "feat: add side-by-side diff modal for correction comparison"
```

---

### Task 4: Manual verification

- [ ] **Step 1: Start dev server**

```bash
rtk pnpm dev
```

- [ ] **Step 2: Navigate to a corrected chapter**

Open a project chapter that has at least one correction version. Verify:

- The "Compare" button appears next to the "Corrected" badge
- Clicking "Compare" opens the modal with side-by-side panels
- Original text on the left shows deletions in red with strikethrough
- Corrected text on the right shows additions in green
- Scrolling one panel syncs the other
- Closing the modal works

- [ ] **Step 3: Verify edge cases**

- Chapter with no corrections: "Compare" button does NOT appear
- Correction with no previous assembly: button does NOT appear (guarded by `correctionOriginalText`)
- Long text: scroll sync works both ways
- Dark mode: colors are readable in both themes

---

### Task 5: Run full test suite

- [ ] **Step 1: Run tests**

```bash
rtk pnpm test
```

Expected: all existing tests pass

- [ ] **Step 2: Run lint**

```bash
rtk pnpm lint
```

Expected: no new lint errors
