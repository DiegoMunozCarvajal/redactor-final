# Design System Foundation — Spec

**Date**: 2026-05-17
**Status**: Approved
**Subsystem**: 1 of 7 (UI Overhaul)

## Context

redactor-v4 currently uses shadcn/ui default neutral theme (HSL, hue=0, grayscale-only) with no brand color, custom typography, or motion tokens. Components are inconsistently applied — some pages use shadcn primitives, others use raw native elements with ad-hoc Tailwind. This spec defines the design system foundation that all subsequent UI work depends on.

## Design Decisions (Validated)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Personality | Sobrio y profesional (Stripe-like) | User preference |
| Layout pattern | Navbar + breadcrumbs with contextual sidebar in admin | Hybrid; few top-level sections, deep admin hierarchy |
| Primary color | Slate Blue (OKLCH hue 250°) | Professional, works in light+dark without adjustment |
| Dark/light | Both equal, system default | Accessibility, modern standard |
| Typography | Geist Sans + Geist Mono | Designed for Next.js/shadcn, excellent readability at small sizes |

## New Dependencies

```json
{
  "motion": "^12.x",
  "motion-primitives": "latest",
  "nuqs": "^2.x",
  "react-hook-form": "^7.x",
  "@hookform/resolvers": "^5.x",
  "zustand": "^5.x",
  "@number-flow/react": "^0.5.x",
  "date-fns": "^4.x"
}
```

Origin UI components added via `npx shadcn@latest add <component>` from origin-ui registry.

## Component Architecture

```
components/
  ui/          # shadcn/ui + origin-ui base components. NEVER edit directly.
  custom/      # Wrappers extending ui/ with extra Tailwind. Safe to edit.
  patterns/    # Business compositions consuming ui/ + custom/. Multi-component.
```

**Rule**: `ui/` is CLI-managed. All customizations live in `custom/` via the Wrapper Pattern:
```tsx
// components/custom/custom-button.tsx
import { Button } from "@/components/ui/button"
export function CustomButton({ ...props }) {
  return <Button className="extra-classes" {...props} />
}
```

Existing domain components (`components/projects/`, `components/prompts/`) move to `components/patterns/` and refactored to use `ui/` + `custom/` primitives instead of native elements.

## Design Tokens

### Layer 1 — Base (Primitives)

```css
@theme {
  /* Slate Blue scale — OKLCH, hue 250 */
  --color-brand-50: oklch(96% 0.005 250);
  --color-brand-100: oklch(90% 0.01 250);
  --color-brand-200: oklch(82% 0.02 250);
  --color-brand-300: oklch(72% 0.04 250);
  --color-brand-400: oklch(62% 0.08 250);
  --color-brand-500: oklch(52% 0.12 250);
  --color-brand-600: oklch(42% 0.14 250);
  --color-brand-700: oklch(32% 0.12 250);
  --color-brand-800: oklch(24% 0.08 250);
  --color-brand-900: oklch(16% 0.04 250);

  /* Neutral scale — OKLCH, hue 0 */
  --color-neutral-50: oklch(98% 0 0);
  --color-neutral-100: oklch(95% 0 0);
  --color-neutral-200: oklch(90% 0 0);
  --color-neutral-300: oklch(82% 0 0);
  --color-neutral-400: oklch(68% 0 0);
  --color-neutral-500: oklch(55% 0 0);
  --color-neutral-600: oklch(42% 0 0);
  --color-neutral-700: oklch(30% 0 0);
  --color-neutral-800: oklch(20% 0 0);
  --color-neutral-900: oklch(12% 0 0);

  /* Semantic: success, warning, error, info */
  --color-success-500: oklch(55% 0.18 145);
  --color-warning-500: oklch(65% 0.16 85);
  --color-error-500: oklch(50% 0.20 25);
  --color-info-500: oklch(55% 0.12 250);

  /* Spacing */
  --spacing-1: 0.25rem;
  --spacing-2: 0.5rem;
  --spacing-3: 0.75rem;
  --spacing-4: 1rem;
  --spacing-6: 1.5rem;
  --spacing-8: 2rem;
  --spacing-12: 3rem;
  --spacing-16: 4rem;

  /* Radii */
  --radius-sm: 0.25rem;
  --radius-md: 0.5rem;
  --radius-lg: 0.75rem;
  --radius-full: 9999px;

  /* Font sizes */
  --text-xs: 0.75rem;
  --text-sm: 0.875rem;
  --text-base: 1rem;
  --text-lg: 1.125rem;
  --text-xl: 1.25rem;
  --text-2xl: 1.5rem;
  --text-3xl: 1.875rem;

  /* Motion */
  --duration-fast: 100ms;
  --duration-normal: 200ms;
  --duration-slow: 300ms;
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);
}
```

### Layer 2 — Semantic (Light)

```css
:root {
  --background: var(--color-neutral-50);
  --foreground: var(--color-neutral-900);
  --card: var(--color-neutral-50);
  --card-foreground: var(--color-neutral-900);
  --popover: var(--color-neutral-50);
  --popover-foreground: var(--color-neutral-900);
  --primary: var(--color-brand-500);
  --primary-foreground: white;
  --secondary: var(--color-neutral-100);
  --secondary-foreground: var(--color-neutral-900);
  --muted: var(--color-neutral-100);
  --muted-foreground: var(--color-neutral-500);
  --accent: var(--color-brand-50);
  --accent-foreground: var(--color-brand-700);
  --destructive: var(--color-error-500);
  --destructive-foreground: white;
  --border: var(--color-neutral-200);
  --input: var(--color-neutral-200);
  --ring: var(--color-brand-400);
}
```

### Layer 2 — Semantic (Dark)

```css
.dark {
  --background: var(--color-neutral-900);
  --foreground: var(--color-neutral-50);
  --card: oklch(15% 0 0);
  --card-foreground: var(--color-neutral-50);
  --popover: oklch(15% 0 0);
  --popover-foreground: var(--color-neutral-50);
  --primary: var(--color-brand-400);
  --primary-foreground: var(--color-neutral-900);
  --secondary: var(--color-neutral-800);
  --secondary-foreground: var(--color-neutral-50);
  --muted: var(--color-neutral-800);
  --muted-foreground: var(--color-neutral-400);
  --accent: oklch(25% 0.06 250);
  --accent-foreground: var(--color-brand-200);
  --destructive: oklch(45% 0.18 25);
  --destructive-foreground: white;
  --border: var(--color-neutral-700);
  --input: var(--color-neutral-700);
  --ring: var(--color-brand-500);
}
```

## Typography

### Font Loading (`app/layout.tsx`)

```tsx
import { Geist, Geist_Mono } from "next/font/google"

const geist = Geist({
  variable: "--font-geist",
  subsets: ["latin"],
  axes: ["wdth"], // variable width
})

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
})
```

### Font Stack

```css
--font-sans: "Geist", var(--font-geist), system-ui, -apple-system, sans-serif;
--font-mono: "Geist Mono", var(--font-geist-mono), "JetBrains Mono", ui-monospace, monospace;
```

### Type Scale Application

- **Body**: `text-base` (16px), `leading-relaxed` (1.625)
- **Headings**: Geist Sans, `tracking-tight`, `font-semibold`
- **Mono/Data**: Geist Mono, `font-variant-numeric: tabular-nums` for metrics
- **Font smoothing**: `-webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale` on `body`

## Motion

### Tokens

| Element | Duration | Easing |
|---------|----------|--------|
| Hover state | `--duration-fast` (100ms) | `--ease-out` |
| Button press | `--duration-normal` (200ms) | `--ease-out` |
| Tooltip/Dropdown | 100ms / 200ms | `--ease-out` |
| Modal | `--duration-slow` (300ms) | `--ease-in-out` |
| Page transition | 500ms | `--ease-in-out` |

### Usage

- **CSS transitions** for hover/focus/color changes (prefer over JS)
- **Motion** (`motion/react`) for: layout animations, AnimatePresence (exit), staggered lists, scroll-linked effects
- **Motion-Primitives** for pre-built animated components (text effects, animated numbers, magnetic buttons)
- All animations gated on `prefers-reduced-motion: no-preference`

### Stagger Pattern

```tsx
import { motion } from "motion/react"

function ChapterList({ chapters }) {
  return (
    <div>
      {chapters.map((ch, i) => (
        <motion.div
          key={ch.id}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.05, duration: 0.2 }}
        >
          <ChapterCard chapter={ch} />
        </motion.div>
      ))}
    </div>
  )
}
```

## Quality-of-Life Libraries Integration

### URL State (`nuqs`)

```tsx
// Replace manual useSearchParams + useState + useEffect
import { useQueryState } from "nuqs"

function ProjectList() {
  const [search, setSearch] = useQueryState("q")
  const [status, setStatus] = useQueryState("status")
  // Type-safe, bookmarkable, SSR-compatible
}
```

### Form Management (`react-hook-form` + `zod`)

```tsx
// Used in PromptEditor, CreateProjectDialog, auth forms
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"

const promptSchema = z.object({
  type: z.enum(["apertura", "modelo", /* ... */]),
  content: z.string().min(1),
  styleRules: z.string().optional(),
})

function PromptEditor() {
  const form = useForm({ resolver: zodResolver(promptSchema) })
  // ...
}
```

### Client UI State (`zustand`)

```tsx
// Sidebar state, draft editors, wizard steps
import { create } from "zustand"

const useSidebar = create<SidebarState>((set) => ({
  collapsed: true,
  toggle: () => set((s) => ({ collapsed: !s.collapsed })),
}))
```

### Animated Numbers (`@number-flow/react`)

```tsx
// Word counts, token usage, progress percentages
import NumberFlow from "@number-flow/react"

<NumberFlow value={wordCount} format={{ notation: "compact" }} />
```

## Implementation Plan

### Phase 1 — Foundation (this spec)

1. Add new dependencies (`pnpm add motion nuqs react-hook-form @hookform/resolvers zustand @number-flow/react date-fns`)
2. Install origin-ui CLI registry
3. Rewrite `app/globals.css` with OKLCH tokens, typography, motion
4. Configure Geist fonts in `app/layout.tsx`
5. Create `components/custom/` directory with wrapper pattern
6. Verify dark/light mode toggle works with new tokens
7. Run visual regression check on existing pages

### Phase 2 — Component Migration (subsequent specs)

1. Audit all existing pages for native element usage
2. Replace native elements with `ui/` + `custom/` equivalents via origin-ui
3. Move existing `components/projects/`, `components/prompts/` to `components/patterns/`
4. Add missing components via `npx shadcn@latest add` from origin-ui registry

### Files to Create

- `components/custom/` — directory with first wrappers as needed
- `components/patterns/` — directory (migration target)

### Files to Modify

- `app/globals.css` — full rewrite with OKLCH tokens, Geist, motion
- `app/layout.tsx` — Geist font loading, theme provider updated
- `package.json` — new dependencies

### Files NOT to Modify

- `components/ui/*` — CLI-managed, not touched directly
- `lib/db/*` — no changes
- `trigger/*` — no changes
- API routes — no changes

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| OKLCH rendering on old browsers | Tailwind v4 transpiles to sRGB fallback. Safari 15+, Chrome 111+, Firefox 113+ |
| Origin UI conflicts with existing shadcn components | Install incrementally. Test each component page before adding next |
| Geist font causing layout shift | `next/font/google` with `variable` and `display: swap` prevents shift |
| Motion bundle size | Tree-shaken. Only animate where functional value exists. CSS transitions for simple cases |

## Success Criteria

- [ ] Light/dark mode toggle works with all new tokens
- [ ] Brand color (Slate Blue) visible in buttons, links, focus rings
- [ ] Geist fonts render on all pages
- [ ] Existing pages render without visual breakage
- [ ] `prefers-reduced-motion` disables animations
- [ ] Color contrast passes WCAG AA (4.5:1 normal, 3:1 large)
- [ ] No raw native `<input>`/`<button>`/`<select>` usage in new code
- [ ] All new components use `cn()` utility
