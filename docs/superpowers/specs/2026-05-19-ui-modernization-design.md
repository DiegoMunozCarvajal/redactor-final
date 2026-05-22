# UI Modernization — Design Spec

**Date**: 2026-05-19
**Status**: Approved
**Context**: Research-driven modernization aligning redactor-v4 with 2026 SaaS web design standards.

## Decisions

### 1. Typography — Lora + Geist Sans

| Role | Font | Usage |
|------|------|-------|
| Body & UI | Lora (serif, Google Fonts) | Cards, descriptions, inputs, buttons, nav |
| Headings | Geist Sans (geometric sans) | Page titles, card titles, dialog titles |
| Code/Editor | MesloLGS NF (existing) | Prompt editor, JSON views, code blocks |

**Rationale**: Lora is a screen-optimized serif — editorial warmth for a book platform. Geist Sans for UI clarity. Meslo stays for technical surfaces.

**Implementation**:
- Add `next/font/google` for Lora with `variable: "--font-lora"` (weights: 400, 500, 600, 700)
- Install `geist` npm package, use `next/font/local` for Geist Sans with `variable: "--font-geist-sans"`
- Update `globals.css` `--font-sans` to Geist Sans, `--font-serif` to Lora
- Update `--font-mono` stays Meslo
- Body uses Lora (serif), headings/UI use Geist Sans

### 2. Layout — Collapsible Sidebar

Replace top navbar nav links with a collapsible vertical sidebar.

**Structure**:
```
Sidebar
├── Logo + Brand (collapsed: icon only)
├── Projects (active state)
├── Templates
├── Settings (future)
└── Footer: collapse toggle + density toggle
```

**Behavior**:
- Default: expanded (240px)
- Collapsed: 56px (icons only + tooltips)
- Toggle via sidebar footer button
- Mobile (<768px): drawer overlay triggered by hamburger
- State persisted to localStorage key `sidebar-collapsed`
- Main content shifts with sidebar width via CSS `transition-all duration-200` (CSS pure, no framer-motion on layout shift)

**Component**: `components/patterns/sidebar.tsx` (new)
**Layout change**: `app/layout.tsx` wraps content in flex container: Sidebar + main

### 3. Projects Page — Bento Grid

First row has 3 special cards, then uniform grid below.

**Hero Row** (on projects with data):
```
[Continue Writing (span 2 cols, 2 rows)]  [Quick Start]
[                                          ]  [Stats       ]
```

- **Continue Writing**: last active project. Shows title, progress (x/y chapters), last edited relative time. Links to that project.
- **Quick Start**: "New Book" CTA button. Opens existing `CreateProjectDialog` component.
- **Stats**: total projects, total chapters across all projects, completed chapters count. Computed client-side from `projects` array — no new API.

**Below hero**: regular 3-column grid of ProjectCards.

**Empty state** (0 projects): guided message with single CTA "Create your first project" + 3-step preview.

### 4. Density Toggle

**Token**: CSS custom property `--density` on `<html>`.
- `--density: 1` (relaxed, default)
- `--density: 0.65` (compact)

**Affected properties** (via calc):
- Card padding, gap between cards
- Chapter list item padding
- Font size delta on body text

**Toggle**: button in sidebar footer. Icons: `Sun` / `Columns2` from lucide-react. Persisted to localStorage key `ui-density`.

**Guard**: respect `prefers-reduced-motion` — instant switch, no transition.

### 5. Fluid Typography

`clamp()` on all heading levels in `globals.css`:

```css
h1 { font-size: clamp(1.5rem, 4vw, 2.25rem); }
h2 { font-size: clamp(1.25rem, 3vw, 1.5rem); }
```

Combined with `rem` base so user zoom preferences work.

### 6. Empty State

Projects page (0 projects):
- Icon (BookOpen, larger)
- Heading: "Your first book is waiting"
- Description: value prop in 1 sentence
- Primary CTA button: "Create your first project"
- 3-step preview below: "1. Pick template → 2. Set topic → 3. Generate"

Removes old static icon + text. No secondary links.

### 7. Skeleton Loading

New component: `components/patterns/project-card-skeleton.tsx`.

Matches ProjectCard geometry:
- Same border, border-radius, padding
- Icon placeholder (20x20, rounded)
- Title bar placeholder (60-75% width, variable per card)
- Description bar placeholder (80-90% width)
- Timestamp bar placeholder (30-40% width)

Wrapped in staggered animation matching real card entrance (0.05s delay per index).

Used on projects page during loading instead of generic `animate-pulse` divs.

## Files Changed

| File | Change |
|------|--------|
| `app/globals.css` | Font stacks, density token, fluid typography, radius tokens |
| `app/layout.tsx` | Add Lora + Geist font loading, sidebar wrapper, density class |
| `components/patterns/sidebar.tsx` | **New** — collapsible sidebar component |
| `components/patterns/navbar.tsx` | Remove nav links, keep logo + user menu |
| `app/projects/page.tsx` | Bento hero row, empty state, skeleton loading |
| `components/patterns/project-card.tsx` | Minor: accept density styling |
| `components/patterns/project-card-skeleton.tsx` | **New** — content-shaped skeleton |
| `components/patterns/continue-writing-card.tsx` | **New** — hero 2-col card |
| `components/patterns/quick-start-card.tsx` | **New** — CTA card that opens CreateProjectDialog |
| `components/patterns/stats-card.tsx` | **New** — project stats summary |
| `lib/hooks/use-density.ts` | **New** — density state hook |

## Scope — NOT Included

- Settings page (sidebar link exists but goes nowhere for now)
- Mobile sidebar: simple drawer fallback, not full mobile redesign
- Dark mode changes: existing dark mode tokens stay, new components respect them
- Animation library changes: keep framer-motion
- API changes: all UI-only, backend untouched

## Verification

- `pnpm typecheck` passes
- `pnpm build` succeeds
- Light + dark mode: all new components render correctly
- Sidebar collapses/expands smoothly
- Density toggle affects all cards and lists
- Responsive: sidebar becomes drawer on mobile
- Empty state: renders when 0 projects, disappears after creation
