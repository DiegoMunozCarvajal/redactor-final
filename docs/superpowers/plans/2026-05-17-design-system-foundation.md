# Design System Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace grayscale-only HSL tokens with OKLCH Slate Blue design system, integrate Geist fonts, add motion tokens, and establish 3-folder component architecture.

**Architecture:** CSS-first design tokens in Tailwind v4 `@theme` directive. 3-layer token system: base (OKLCH primitives) → semantic (purpose-driven) → component (variant-specific). Geist fonts via `next/font/google` with CSS variable injection. All existing shadcn/ui + Radix components reference semantic tokens — no component code changes needed in this phase.

**Tech Stack:** Tailwind v4 (CSS config), next/font/google (Geist Sans + Geist Mono), motion (animation), OKLCH color space

---

## File Map

| Action | Path | Purpose |
|--------|------|---------|
| Modify | `app/globals.css` | Replace HSL tokens with OKLCH design tokens, add font/motion CSS vars, add `@plugin "tw-animate-css"` |
| Modify | `app/layout.tsx` | Load Geist fonts, apply font variables to body |
| Create | `components/custom/.gitkeep` | Placeholder for wrapper components directory |
| Create | `components/patterns/.gitkeep` | Placeholder for business pattern components directory |
| Modify | `package.json` | Add new dependencies |

Files NOT modified: `components/ui/*`, `lib/*`, `postcss.config.mjs`, `middleware.ts`, all pages, all API routes.

---

### Task 1: Install new dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add runtime dependencies**

```bash
pnpm add motion nuqs react-hook-form @hookform/resolvers zustand @number-flow/react date-fns
```

Expected: 7 packages added to `package.json` and `pnpm-lock.yaml`. No build errors.

- [ ] **Step 2: Verify install**

```bash
node -e "require('motion'); console.log('motion OK')"
node -e "require('nuqs'); console.log('nuqs OK')"
node -e "require('react-hook-form'); console.log('rhf OK')"
node -e "require('zustand'); console.log('zustand OK')"
node -e "require('date-fns'); console.log('date-fns OK')"
```

Expected: each prints "X OK", no errors.

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: add UI dependencies (motion, nuqs, rhf, zustand, number-flow, date-fns)"
```

---

### Task 2: Rewrite globals.css with OKLCH design tokens

**Files:**
- Modify: `app/globals.css`

The current file is 48 lines of HSL-only tokens. We replace it with a 3-layer OKLCH token system plus typography and motion foundations.

- [ ] **Step 1: Write the new globals.css**

Replace the entire content of `app/globals.css`:

```css
@import "tailwindcss";

@plugin "@tailwindcss/typography";

/* =============================================
   Layer 1 — Base Tokens (OKLCH Primitives)
   ============================================= */

@theme {
  /* Slate Blue — hue 250 */
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

  /* Neutral gray — hue 0 */
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

  /* Semantic colors */
  --color-success: oklch(55% 0.18 145);
  --color-warning: oklch(65% 0.16 85);
  --color-error: oklch(50% 0.2 25);
  --color-info: oklch(55% 0.12 250);
}

/* =============================================
   Layer 2 — Semantic Tokens (Light Mode)
   ============================================= */

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
  --destructive: var(--color-error);
  --destructive-foreground: white;
  --border: var(--color-neutral-200);
  --input: var(--color-neutral-200);
  --ring: var(--color-brand-400);
  --radius: 0.5rem;

  /* Font stacks */
  --font-sans: "Geist", var(--font-geist), system-ui, -apple-system, sans-serif;
  --font-mono: "Geist Mono", var(--font-geist-mono), "JetBrains Mono", ui-monospace, monospace;

  /* Motion durations */
  --duration-fast: 100ms;
  --duration-normal: 200ms;
  --duration-slow: 300ms;

  /* Motion easings */
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);

  /* Animation presets */
  --animate-fade-in: fade-in var(--duration-normal) var(--ease-out);
  --animate-slide-up: slide-up var(--duration-normal) var(--ease-out);
}

/* =============================================
   Layer 2 — Semantic Tokens (Dark Mode)
   ============================================= */

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

/* =============================================
   Layer 3 — Base Element Styles
   ============================================= */

body {
  font-family: var(--font-sans);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

/* Tabular numbers for data/metrics — Linear/Stripe signature */
.tnum {
  font-feature-settings: "tnum";
  font-variant-numeric: tabular-nums;
}

/* =============================================
   Layer 3 — Keyframe Definitions
   ============================================= */

@keyframes fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes slide-up {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}

/* =============================================
   Layer 3 — Reduced Motion
   ============================================= */

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

- [ ] **Step 2: Verify Tailwind compiles**

```bash
pnpm build 2>&1 | tail -20
```

Expected: Build succeeds. No CSS compilation errors, no missing token warnings. The `--color-brand-*` tokens must be recognized by Tailwind v4.

- [ ] **Step 3: Verify dev server starts**

```bash
pnpm dev &
sleep 5
curl -s http://localhost:3000 | head -5
kill %1 2>/dev/null
```

Expected: HTML response, no 500 errors. Page loads with new CSS variables.

- [ ] **Step 4: Commit**

```bash
git add app/globals.css
git commit -m "feat: add OKLCH design tokens with Slate Blue brand color"
```

---

### Task 3: Load Geist fonts in root layout

**Files:**
- Modify: `app/layout.tsx`

- [ ] **Step 1: Update app/layout.tsx to load Geist fonts**

Replace `app/layout.tsx` content:

```tsx
import { Navbar } from "@/components/ui/navbar";
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "next-themes";
import { Toaster } from "sonner";
import "./globals.css";

const geist = Geist({
  variable: "--font-geist",
  subsets: ["latin"],
  axes: ["wdth"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Redactor",
  description: "Genera libros de no-ficción en español",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="es"
      suppressHydrationWarning
      className={`${geist.variable} ${geistMono.variable}`}
    >
      <body>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <Navbar />
          <main className="min-h-screen">{children}</main>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
```

Key changes from current:
1. Import `Geist` and `Geist_Mono` from `next/font/google`
2. Instantiate both font loaders with `variable` prop (creates CSS custom properties `--font-geist`, `--font-geist-mono`)
3. Add font variable class names to `<html>` element
4. CSS `--font-sans` and `--font-mono` in `globals.css` reference these variables

- [ ] **Step 2: Verify fonts load**

```bash
pnpm dev &
sleep 5
# Check that the HTML element has font variable classes
curl -s http://localhost:3000 | grep -o 'class="[^"]*"' | head -3
kill %1 2>/dev/null
```

Expected: `<html>` tag includes both font variable class names.

- [ ] **Step 3: Verify typecheck passes**

```bash
pnpm typecheck
```

Expected: No TypeScript errors. `Geist` and `Geist_Mono` are typed by `next/font/google`.

- [ ] **Step 4: Commit**

```bash
git add app/layout.tsx
git commit -m "feat: load Geist Sans and Geist Mono fonts via next/font/google"
```

---

### Task 4: Create component architecture directories

**Files:**
- Create: `components/custom/.gitkeep`
- Create: `components/patterns/.gitkeep`

- [ ] **Step 1: Create directories with README files**

```bash
mkdir -p components/custom components/patterns
```

Write `components/custom/README.md`:

```markdown
# Custom Components

Wrappers extending `components/ui/` with extra Tailwind classes or composed behavior.

**Rule:** Never edit `components/ui/` directly. Extend here via the Wrapper Pattern:

```tsx
import { Button } from "@/components/ui/button"

export function CustomButton({ className, ...props }: React.ComponentProps<typeof Button>) {
  return <Button className={cn("your-extra-classes", className)} {...props} />
}
```

All custom components must re-export the original component's type signature and forward refs.
```

Write `components/patterns/README.md`:

```markdown
# Pattern Components

Business-level compositions that consume `components/ui/` and `components/custom/`.

These are multi-component patterns like `DashboardShell`, `AuthCard`, `ChapterList`, etc.
They represent complete UI sections with specific business behavior.

Existing domain components (`components/projects/`, `components/prompts/`) will be migrated
here in a subsequent phase.
```

- [ ] **Step 2: Verify directory structure**

```bash
ls -la components/custom/ components/patterns/
```

Expected: Both directories exist with README.md files.

- [ ] **Step 3: Commit**

```bash
git add components/custom/ components/patterns/
git commit -m "feat: establish 3-folder component architecture (ui/custom/patterns)"
```

---

### Task 5: Visual verification of design tokens

**Files:**
- None modified (verification only)

- [ ] **Step 1: Start dev server and check CSS variable output**

```bash
pnpm dev &
sleep 5
# Verify brand tokens are in generated CSS
curl -s http://localhost:3000 | grep -o 'oklch([^)]*)' | head -10
kill %1 2>/dev/null
```

Expected: Multiple `oklch(...)` values in the generated CSS output.

- [ ] **Step 2: Verify dark mode class toggling**

Open `http://localhost:3000/projects` in a browser and:
1. Open DevTools → Elements panel
2. Check that `<html>` has class `dark` when system prefers dark, or no `dark` class in light mode
3. Verify `--primary` computed value is `oklch(52% 0.12 250)` in light mode and `oklch(62% 0.08 250)` in dark mode

- [ ] **Step 3: Verify font rendering**

In DevTools → Elements → Computed:
1. Select `<body>` element
2. Check `font-family` resolves to `Geist, Geist, system-ui, -apple-system, sans-serif`
3. Verify `-webkit-font-smoothing: antialiased` is applied

- [ ] **Step 4: Verify all existing pages render without visual breakage**

Navigate to each page and check for layout issues:
- `/projects` — project list
- `/projects/[id]` — project detail (use any existing project ID)
- `/admin/books` — book templates list
- `/admin/books/[id]` — chapter editor (use any existing book ID)
- `/login` — auth page

Expected: All pages render. Brand color visible on buttons, links, focus rings. No missing colors, no layout shifts. Mono elements (run IDs, code blocks) use Geist Mono.

---

### Task 6: Final build verification

**Files:**
- None modified (verification only)

- [ ] **Step 1: Run full production build**

```bash
pnpm build
```

Expected: Build completes successfully. No CSS warnings. No font-related errors.

- [ ] **Step 2: Run typecheck**

```bash
pnpm typecheck
```

Expected: No TypeScript errors.

- [ ] **Step 3: Run existing tests**

```bash
pnpm test
```

Expected: All existing tests pass. Design system changes don't break business logic tests.

- [ ] **Step 4: Verify no visual regression in key components**

Open `http://localhost:3000` in browser after `pnpm build && pnpm start`:
1. Check Navbar — brand color on active nav link, user menu works
2. Check Buttons — primary buttons use Slate Blue, destructive uses red
3. Check Cards — use `--card` background, `--border` for borders
4. Check Badges — status colors use semantic tokens
5. Check Inputs — focus ring uses brand color

---

## Completion Checklist

- [ ] `pnpm build` passes
- [ ] `pnpm typecheck` passes
- [ ] `pnpm test` passes
- [ ] Light mode: brand color visible, Geist fonts render
- [ ] Dark mode: brand color adapts, contrast meets WCAG AA
- [ ] All existing pages render without visual breakage
- [ ] `prefers-reduced-motion: reduce` disables animations
- [ ] `components/custom/` and `components/patterns/` directories exist with README
- [ ] No raw native `<input>`/`<button>`/`<select>` in new code
