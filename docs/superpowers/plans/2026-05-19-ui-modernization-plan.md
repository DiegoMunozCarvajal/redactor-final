# UI Modernization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align redactor-v4 UI with 2026 SaaS web design standards — typography, sidebar, bento grid, density toggle, fluid type, empty states, skeleton loading.

**Architecture:** Collapsible sidebar replaces navbar links. Layout becomes flex row (sidebar + main). Projects page gets bento hero row (ContinueWriting 2-col + QuickStart + Stats) above regular card grid. CSS custom property `--density` controls compact mode. Lora serif for body, Geist Sans for headings/UI, Meslo stays for code surfaces.

**Tech Stack:** Next.js 15.5, React 19, Tailwind CSS 4, shadcn/ui, Radix UI, motion (framer-motion), next-themes, lucide-react, geist npm package, Lora from next/font/google.

---

### Task 1: Install Dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install geist package**

Run: `pnpm add geist`
Expected: Adds geist to package.json dependencies.

- [ ] **Step 2: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: add geist font package"
```

---

### Task 2: Update globals.css — Fonts, Density, Fluid Typography

**Files:**
- Modify: `app/globals.css`

- [ ] **Step 1: Replace font stacks, add density token, add fluid typography, add radius tokens**

Replace the `@theme` block font stacks section and add new tokens. Also add fluid type styles after the keyframes block.

The `@theme` block's font section changes from:
```css
--font-sans: "MesloLGS NF", var(--font-meslo), system-ui, -apple-system, sans-serif;
--font-mono: "MesloLGS NF", var(--font-meslo), "JetBrains Mono", ui-monospace, monospace;
```
to:
```css
--font-sans: "Geist Sans", var(--font-geist-sans), system-ui, -apple-system, sans-serif;
--font-serif: "Lora", var(--font-lora), "Georgia", "Times New Roman", serif;
--font-mono: "MesloLGS NF", var(--font-meslo), "JetBrains Mono", ui-monospace, monospace;
```

Add to the `@theme` block (after `--radius`):
```css
--radius-sm: 0.25rem;
--radius-md: 0.5rem;
--radius-lg: 0.75rem;
```

Replace the body selector with:
```css
body {
  font-family: var(--font-serif);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

h1, h2, h3, h4, h5, h6 {
  font-family: var(--font-sans);
}

h1 { font-size: clamp(1.5rem, 4vw, 2.25rem); }
h2 { font-size: clamp(1.25rem, 3vw, 1.5rem); }
h3 { font-size: clamp(1.125rem, 2vw, 1.25rem); }

.ui-sans {
  font-family: var(--font-sans);
}

code, pre, .font-mono {
  font-family: var(--font-mono);
}
```

Add after the `:root` block (before the `.dark` block) — the density system:
```css
:root {
  --density: 1;
  --density-card-padding-y: calc(1.5rem * var(--density));
  --density-card-padding-x: calc(1.5rem * var(--density));
  --density-card-gap: calc(1rem * var(--density));
  --density-list-item-padding-y: calc(0.75rem * var(--density));
}

.density-compact {
  --density: 0.6;
}
```

Update button variants to use `--radius-md` instead of hardcoded `rounded-md`. In the button component this is already `rounded-md` via shadcn default, keep as-is — the radius tokens apply to NEW components.

- [ ] **Step 2: Commit**

```bash
git add app/globals.css
git commit -m "feat: add font stacks, density tokens, fluid typography"
```

---

### Task 3: Create useDensity Hook

**Files:**
- Create: `lib/hooks/use-density.ts`

- [ ] **Step 1: Create the hooks directory and file**

```bash
mkdir -p lib/hooks
```

Write `lib/hooks/use-density.ts`:

```typescript
"use client";

import { useCallback, useEffect, useState } from "react";

const DENSITY_KEY = "ui-density";
type Density = "relaxed" | "compact";

function getStoredDensity(): Density {
  if (typeof window === "undefined") return "relaxed";
  return (localStorage.getItem(DENSITY_KEY) as Density) ?? "relaxed";
}

export function useDensity() {
  const [density, setDensityState] = useState<Density>("relaxed");

  useEffect(() => {
    setDensityState(getStoredDensity());
  }, []);

  const setDensity = useCallback((d: Density) => {
    setDensityState(d);
    localStorage.setItem(DENSITY_KEY, d);
    const root = document.documentElement;
    if (d === "compact") {
      root.classList.add("density-compact");
    } else {
      root.classList.remove("density-compact");
    }
  }, []);

  const toggleDensity = useCallback(() => {
    setDensity(density === "relaxed" ? "compact" : "relaxed");
  }, [density, setDensity]);

  // Sync on mount
  useEffect(() => {
    if (getStoredDensity() === "compact") {
      document.documentElement.classList.add("density-compact");
    }
  }, []);

  return { density, setDensity, toggleDensity };
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/hooks/use-density.ts
git commit -m "feat: add useDensity hook with localStorage persistence"
```

---

### Task 4: Create Sidebar Component

**Files:**
- Create: `components/patterns/sidebar.tsx`

- [ ] **Step 1: Write the sidebar component**

Write `components/patterns/sidebar.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import {
  BookOpen,
  Layers,
  PanelLeftClose,
  PanelLeftOpen,
  Sun,
  Columns2,
} from "lucide-react";
import { useDensity } from "@/lib/hooks/use-density";
import { cn } from "@/lib/utils";

const SIDEBAR_KEY = "sidebar-collapsed";
const MOBILE_BREAKPOINT = 768;

const NAV_ITEMS = [
  { href: "/projects", label: "Projects", icon: BookOpen },
  { href: "/templates", label: "Templates", icon: Layers },
];

function getStoredCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(SIDEBAR_KEY) === "true";
}

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const { density, toggleDensity } = useDensity();

  useEffect(() => {
    setCollapsed(getStoredCollapsed());
  }, []);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  useEffect(() => {
    if (isMobile) {
      setMobileOpen(false);
    }
  }, [pathname, isMobile]);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(SIDEBAR_KEY, String(next));
      return next;
    });
  }, []);

  // Skip rendering on auth pages
  const AUTH_ROUTES = ["/login", "/forgot-password", "/reset-password", "/callback"];
  if (AUTH_ROUTES.includes(pathname)) return null;

  // Mobile hamburger
  if (isMobile) {
    return (
      <>
        <button
          className="fixed top-3 left-4 z-50 p-2 rounded-md hover:bg-accent transition-colors"
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label="Toggle navigation"
        >
          <BookOpen className="h-5 w-5 text-brand-500" />
        </button>

        {mobileOpen && (
          <div className="fixed inset-0 z-40 flex">
            <div
              className="fixed inset-0 bg-black/50"
              onClick={() => setMobileOpen(false)}
            />
            <nav className="relative z-50 w-60 bg-background border-r border-border h-full flex flex-col py-4 animate-in slide-in-from-left">
              <SidebarContent
                pathname={pathname}
                collapsed={false}
                density={density}
                onToggleCollapse={toggleCollapsed}
                onToggleDensity={toggleDensity}
              />
            </nav>
          </div>
        )}
      </>
    );
  }

  // Desktop sidebar
  const width = collapsed ? 56 : 240;

  return (
    <motion.aside
      animate={{ width }}
      initial={{ width }}
      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
      className="h-screen sticky top-0 border-r border-border bg-background flex flex-col shrink-0 overflow-hidden"
    >
      <SidebarContent
        pathname={pathname}
        collapsed={collapsed}
        density={density}
        onToggleCollapse={toggleCollapsed}
        onToggleDensity={toggleDensity}
      />
    </motion.aside>
  );
}

function SidebarContent({
  pathname,
  collapsed,
  density,
  onToggleCollapse,
  onToggleDensity,
}: {
  pathname: string;
  collapsed: boolean;
  density: string;
  onToggleCollapse: () => void;
  onToggleDensity: () => void;
}) {
  return (
    <>
      {/* Logo */}
      <div className="flex items-center h-14 px-4 border-b border-border shrink-0">
        <BookOpen className="h-5 w-5 text-brand-500 shrink-0" />
        {!collapsed && (
          <span className="ml-3 font-semibold text-sm tracking-tight whitespace-nowrap">
            Redactor
          </span>
        )}
      </div>

      {/* Nav items */}
      <nav className="flex-1 py-2 px-2 space-y-1">
        {NAV_ITEMS.map((item) => {
          const active = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center rounded-md transition-colors text-sm font-medium",
                collapsed ? "justify-center px-0 py-2" : "px-3 py-2 gap-3",
                active
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
              )}
              title={collapsed ? item.label : undefined}
            >
              <item.icon className="h-4 w-4 shrink-0" />
              {!collapsed && <span className="whitespace-nowrap">{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      {/* Footer controls */}
      <div className="border-t border-border p-2 space-y-1">
        <button
          onClick={onToggleDensity}
          className={cn(
            "flex items-center w-full rounded-md transition-colors text-sm text-muted-foreground hover:text-foreground hover:bg-accent/50",
            collapsed ? "justify-center px-0 py-2" : "px-3 py-2 gap-3"
          )}
          title={collapsed ? `Density: ${density}` : undefined}
        >
          {density === "relaxed" ? (
            <Sun className="h-4 w-4 shrink-0" />
          ) : (
            <Columns2 className="h-4 w-4 shrink-0" />
          )}
          {!collapsed && <span className="whitespace-nowrap">Density</span>}
        </button>

        <button
          onClick={onToggleCollapse}
          className={cn(
            "flex items-center w-full rounded-md transition-colors text-sm text-muted-foreground hover:text-foreground hover:bg-accent/50",
            collapsed ? "justify-center px-0 py-2" : "px-3 py-2 gap-3"
          )}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? (
            <PanelLeftOpen className="h-4 w-4 shrink-0" />
          ) : (
            <PanelLeftClose className="h-4 w-4 shrink-0" />
          )}
          {!collapsed && <span className="whitespace-nowrap">Collapse</span>}
        </button>
      </div>
    </>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/patterns/sidebar.tsx
git commit -m "feat: add collapsible sidebar with density toggle"
```

---

### Task 5: Update layout.tsx — Font Loading + Sidebar

**Files:**
- Modify: `app/layout.tsx`

- [ ] **Step 1: Add Lora + Geist font loading, wrap with sidebar**

Verified: geist 1.7.0 provides individual weight .woff2 files (no variable font). Paths confirmed.

Replace `app/layout.tsx` with:

```tsx
import { Navbar } from "@/components/patterns/navbar";
import { Sidebar } from "@/components/patterns/sidebar";
import { CommandPalette } from "@/components/patterns/command-palette";
import type { Metadata } from "next";
import localFont from "next/font/local";
import { Lora } from "next/font/google";
import { ThemeProvider } from "next-themes";
import { Toaster } from "sonner";
import "./globals.css";

const meslo = localFont({
  src: [
    { path: "../fonts/MesloLGS-NF-Regular.ttf", weight: "400", style: "normal" },
    { path: "../fonts/MesloLGS-NF-Italic.ttf", weight: "400", style: "italic" },
    { path: "../fonts/MesloLGS-NF-Bold.ttf", weight: "700", style: "normal" },
    { path: "../fonts/MesloLGS-NF-Bold-Italic.ttf", weight: "700", style: "italic" },
  ],
  variable: "--font-meslo",
  display: "swap",
});

const lora = Lora({
  subsets: ["latin"],
  variable: "--font-lora",
  display: "swap",
});

// Geist Sans loaded from npm geist package (installed in Task 1)
// Path: node_modules/geist/dist/fonts/geist-sans/
const geistSans = localFont({
  src: [
    {
      path: "../../node_modules/geist/dist/fonts/geist-sans/Geist-Regular.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "../../node_modules/geist/dist/fonts/geist-sans/Geist-Medium.woff2",
      weight: "500",
      style: "normal",
    },
    {
      path: "../../node_modules/geist/dist/fonts/geist-sans/Geist-SemiBold.woff2",
      weight: "600",
      style: "normal",
    },
    {
      path: "../../node_modules/geist/dist/fonts/geist-sans/Geist-Bold.woff2",
      weight: "700",
      style: "normal",
    },
  ],
  variable: "--font-geist-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Redactor",
  description: "Generates non-fiction books in Spanish",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${meslo.variable} ${lora.variable} ${geistSans.variable}`}
    >
      <body className="bg-background text-foreground">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <div className="flex min-h-screen">
            <Sidebar />
            <div className="flex-1 flex flex-col min-w-0">
              <Navbar />
              <main className="flex-1 max-w-6xl mx-auto w-full px-6">
                {children}
              </main>
            </div>
          </div>
          <Toaster />
          <CommandPalette />
        </ThemeProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add app/layout.tsx
git commit -m "feat: add Lora + Geist fonts, sidebar layout wrapper"
```

---

### Task 6: Update Navbar — Remove Nav Links

**Files:**
- Modify: `components/patterns/navbar.tsx`

- [ ] **Step 1: Strip nav links, keep logo + user menu**

Remove the Projects and Templates links (lines 67-88 in current file). The navbar becomes:

```tsx
"use client";

import { useEffect, useState, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/browser";
import { ChevronDown } from "lucide-react";

const AUTH_ROUTES = [
  "/login",
  "/forgot-password",
  "/reset-password",
  "/callback",
];

const supabase = createClient();

export function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [userResolved, setUserResolved] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    supabase.auth
      .getUser()
      .then(({ data }) => {
        setUser(data.user ?? null);
      })
      .catch(() => setUser(null))
      .finally(() => setUserResolved(true));
  }, []);

  useEffect(() => {
    function handleOutsideMousedown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    if (menuOpen) document.addEventListener("mousedown", handleOutsideMousedown);
    return () => document.removeEventListener("mousedown", handleOutsideMousedown);
  }, [menuOpen]);

  if (AUTH_ROUTES.includes(pathname)) return null;

  async function handleLogout() {
    const { error } = await supabase.auth.signOut();
    if (error) return;
    router.push("/login");
  }

  return (
    <header className="sticky top-0 z-30 border-b border-border backdrop-blur-md bg-background/80 h-14 px-6 flex items-center justify-end">
      {userResolved && (
        <div ref={menuRef} className="relative">
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            onKeyDown={(e) => { if (e.key === "Escape") setMenuOpen(false); }}
            aria-expanded={menuOpen}
            aria-haspopup="true"
            aria-controls="user-menu"
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            {user?.email ?? ""}
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
          {menuOpen && (
            <div
              role="menu"
              id="user-menu"
              className="absolute right-0 top-full mt-1 bg-background border border-border rounded-lg shadow-lg py-1 z-50 min-w-[120px]"
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setMenuOpen(false);
                  e.stopPropagation();
                }
              }}
            >
              <button
                role="menuitem"
                onClick={handleLogout}
                className="block w-full text-left px-4 py-2 text-sm hover:bg-accent transition-colors"
              >
                Logout
              </button>
            </div>
          )}
        </div>
      )}
    </header>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/patterns/navbar.tsx
git commit -m "refactor: strip nav links from navbar, sidebar handles navigation"
```

---

### Task 7: Create ProjectCardSkeleton

**Files:**
- Create: `components/patterns/project-card-skeleton.tsx`

- [ ] **Step 1: Write the skeleton component**

Write `components/patterns/project-card-skeleton.tsx`:

```tsx
import { motion } from "motion/react";

export function ProjectCardSkeleton({ index }: { index: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        delay: index * 0.05,
        duration: 0.25,
        ease: [0.16, 1, 0.3, 1],
      }}
    >
      <div className="rounded-lg border bg-card p-6 animate-pulse">
        <div className="flex items-start gap-2">
          <div className="h-5 w-5 bg-muted rounded shrink-0 mt-0.5" />
          <div className="flex-1 space-y-3">
            <div
              className="h-5 bg-muted rounded"
              style={{ width: `${60 + (index % 3) * 12}%` }}
            />
            <div
              className="h-4 bg-muted rounded"
              style={{ width: `${80 + (index % 2) * 10}%` }}
            />
          </div>
        </div>
        <div
          className="h-3 bg-muted rounded mt-4"
          style={{ width: `${30 + (index % 3) * 8}%` }}
        />
      </div>
    </motion.div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/patterns/project-card-skeleton.tsx
git commit -m "feat: add content-shaped project card skeleton"
```

---

### Task 8: Create ContinueWritingCard

**Files:**
- Create: `components/patterns/continue-writing-card.tsx`

- [ ] **Step 1: Write the hero card for last active project**

Write `components/patterns/continue-writing-card.tsx`:

```tsx
import Link from "next/link";
import { BookOpen, Clock } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { enUS } from "date-fns/locale";

interface ContinueWritingCardProps {
  project: {
    id: string;
    title: string | null;
    name: string;
    topic: string;
    createdAt: string;
    chapterCount?: number;
    completedCount?: number;
  };
}

export function ContinueWritingCard({ project }: ContinueWritingCardProps) {
  const progress = (project.chapterCount ?? 0) > 0
    ? Math.round(((project.completedCount ?? 0) / (project.chapterCount ?? 1)) * 100)
    : 0;

  return (
    <Link href={`/projects/${project.id}`}>
      <div className="rounded-lg border bg-gradient-to-br from-brand-50/50 to-accent/30 dark:from-brand-900/20 dark:to-accent/20 p-6 hover:border-brand-200 dark:hover:border-brand-700 transition-all duration-200 h-full flex flex-col justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
            <BookOpen className="h-3.5 w-3.5 text-brand-500" />
            Continue Writing
          </div>
          <h3 className="text-lg font-semibold mb-1 line-clamp-1">
            {project.title ?? project.name}
          </h3>
          <p className="text-sm text-muted-foreground line-clamp-2 mb-4">
            {project.topic}
          </p>
        </div>

        <div>
          <div className="flex items-center justify-between text-xs text-muted-foreground mb-2">
            <span>
              {project.completedCount ?? 0}/{project.chapterCount ?? 0} chapters
            </span>
            <span>{progress}%</span>
          </div>
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-brand-500 rounded-full transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="flex items-center gap-1 mt-3 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />
            {formatDistanceToNow(new Date(project.createdAt), {
              addSuffix: true,
              locale: enUS,
            })}
          </div>
        </div>
      </div>
    </Link>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/patterns/continue-writing-card.tsx
git commit -m "feat: add continue writing hero card"
```

---

### Task 9: Create QuickStartCard

**Files:**
- Create: `components/patterns/quick-start-card.tsx`

- [ ] **Step 1: Write the quick start CTA card**

Write `components/patterns/quick-start-card.tsx`:

```tsx
"use client";

import { BookOpen } from "lucide-react";
import { CreateProjectDialog } from "@/components/projects/create-project-dialog";

interface QuickStartCardProps {
  templates: { id: string; name: string }[];
}

export function QuickStartCard({ templates }: QuickStartCardProps) {
  return (
    <div className="rounded-lg border bg-card p-6 hover:border-brand-200 dark:hover:border-brand-700 transition-all duration-200 h-full flex flex-col items-center justify-center text-center gap-3">
      <div className="h-10 w-10 rounded-full bg-brand-50 dark:bg-brand-900/30 flex items-center justify-center">
        <BookOpen className="h-5 w-5 text-brand-500" />
      </div>
      <div>
        <p className="font-medium text-sm">New Book</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          Start from a template
        </p>
      </div>
      <CreateProjectDialog templates={templates} />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/patterns/quick-start-card.tsx
git commit -m "feat: add quick start card with project dialog"
```

---

### Task 10: Create StatsCard

**Files:**
- Create: `components/patterns/stats-card.tsx`

- [ ] **Step 1: Write the stats summary card**

Write `components/patterns/stats-card.tsx`:

```tsx
import { Layers, CheckCircle2, FileText } from "lucide-react";

interface StatsCardProps {
  totalProjects: number;
  totalChapters: number;
  completedChapters: number;
}

export function StatsCard({
  totalProjects,
  totalChapters,
  completedChapters,
}: StatsCardProps) {
  const stats = [
    {
      icon: FileText,
      value: totalProjects,
      label: "Projects",
    },
    {
      icon: Layers,
      value: totalChapters,
      label: "Chapters",
    },
    {
      icon: CheckCircle2,
      value: completedChapters,
      label: "Completed",
    },
  ];

  return (
    <div className="rounded-lg border bg-card p-6 h-full flex flex-col justify-center">
      <div className="grid grid-cols-3 gap-2">
        {stats.map((s) => (
          <div key={s.label} className="text-center">
            <s.icon className="h-4 w-4 text-muted-foreground mx-auto mb-1" />
            <div className="text-xl font-semibold tabular-nums">{s.value}</div>
            <div className="text-xs text-muted-foreground">{s.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/patterns/stats-card.tsx
git commit -m "feat: add project stats summary card"
```

---

### Task 11: Update Projects API — Include Chapter Counts

**Files:**
- Modify: `app/api/projects/route.ts`

- [ ] **Step 1: Add chapter counts via left join + aggregation**

The current GET query selects only from `projects`. Add a join through `chapters` → `chapterGenerations` to get chapter and completed counts per project.

Update imports at top of `app/api/projects/route.ts` — add:
```typescript
import { count, sql } from "drizzle-orm";
import { chapterGenerations } from "@/lib/db/schema/chapter-generations";
```

Replace the `GET` function query:
```typescript
// Before (line 17-22):
const result = await db
  .select()
  .from(projects)
  .where(eq(projects.userId, user.id))
  .orderBy(desc(projects.createdAt));
return NextResponse.json(result);

// After:
const rows = await db
  .select({
    project: projects,
    chapterCount: count(chapters.id).as("chapterCount"),
    completedCount: sql<number>`count(${chapterGenerations.id}) filter (where ${chapterGenerations.status} = 'completed')`.as("completedCount"),
  })
  .from(projects)
  .leftJoin(chapters, eq(chapters.projectId, projects.id))
  .leftJoin(chapterGenerations, eq(chapterGenerations.chapterId, chapters.id))
  .where(eq(projects.userId, user.id))
  .groupBy(projects.id)
  .orderBy(desc(projects.createdAt));

const result = rows.map((r) => ({
  ...r.project,
  chapterCount: Number(r.chapterCount),
  completedCount: Number(r.completedCount),
}));
return NextResponse.json(result);
```

- [ ] **Step 2: Commit**

```bash
git add app/api/projects/route.ts
git commit -m "feat: include chapter data in projects list endpoint"
```

---

### Task 12: Update projects/page.tsx — Bento Grid + Empty State + Skeletons (continued)

**Files:**
- Modify: `app/projects/page.tsx`

- [ ] **Step 1: Rewrite with bento hero row, empty state, skeleton loading**

Replace `app/projects/page.tsx` with:

```tsx
"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { motion } from "motion/react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CreateProjectDialog } from "@/components/projects/create-project-dialog";
import { ProjectCardSkeleton } from "@/components/patterns/project-card-skeleton";
import { ContinueWritingCard } from "@/components/patterns/continue-writing-card";
import { QuickStartCard } from "@/components/patterns/quick-start-card";
import { StatsCard } from "@/components/patterns/stats-card";
import { BookOpen, Clock, Trash2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { enUS } from "date-fns/locale";

interface ProjectData {
  id: string;
  name: string;
  topic: string;
  title: string | null;
  createdAt: string;
  chapterCount?: number;
  completedCount?: number;
}

interface Template {
  id: string;
  name: string;
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<ProjectData[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchProjects = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch("/api/projects", { signal });
      if (signal?.aborted) return;
      if (res.ok) setProjects(await res.json());
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      throw err;
    }
    setLoading(false);
  }, []);

  const fetchTemplates = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch("/api/books", { signal });
      if (signal?.aborted) return;
      if (res.ok) setTemplates(await res.json());
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      throw err;
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetchProjects(controller.signal);
    fetchTemplates(controller.signal);
    return () => controller.abort();
  }, [fetchProjects, fetchTemplates]);

  async function deleteProject(id: string, name: string) {
    if (!confirm(`Delete project "${name}" and all its generations?`)) return;
    const res = await fetch(`/api/projects/${id}`, { method: "DELETE" });
    if (res.ok) {
      fetchProjects();
    } else {
      const err = await res.json().catch(() => ({ error: "Failed to delete" }));
      alert(err.error ?? "Failed to delete");
    }
  }

  // --- Skeleton loading ---
  if (loading) {
    return (
      <div className="py-6">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Create and manage your book generation projects
            </p>
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <ProjectCardSkeleton key={i} index={i} />
          ))}
        </div>
      </div>
    );
  }

  // --- Empty state ---
  if (projects.length === 0) {
    return (
      <div className="py-6">
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="h-16 w-16 rounded-2xl bg-accent flex items-center justify-center mb-6">
            <BookOpen className="h-8 w-8 text-brand-500" />
          </div>
          <h2 className="text-xl font-semibold mb-2">
            Your first book is waiting
          </h2>
          <p className="text-sm text-muted-foreground max-w-md mb-8">
            AI-powered non-fiction books in Spanish. Pick a template, set a
            topic, and generate a complete book chapter by chapter.
          </p>
          <CreateProjectDialog templates={templates} />
          <div className="flex items-center gap-6 mt-8 text-xs text-muted-foreground/60">
            <span>1. Pick template</span>
            <span className="text-border">→</span>
            <span>2. Set topic</span>
            <span className="text-border">→</span>
            <span>3. Generate</span>
          </div>
        </div>
      </div>
    );
  }

  // --- Compute stats from API response (chapterCount, completedCount) ---
  const totalChapters = projects.reduce(
    (sum, p) => sum + (p.chapterCount ?? 0),
    0,
  );
  const completedChapters = projects.reduce(
    (sum, p) => sum + (p.completedCount ?? 0),
    0,
  );

  // Last active project = first in list
  const lastProject = projects[0];

  // Remaining projects (skip the first one)
  const remainingProjects = projects.slice(1);

  return (
    <div className="py-6">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Create and manage your book generation projects
          </p>
        </div>
      </div>

      {/* Bento Hero Row */}
      <div className="grid gap-4 md:grid-cols-3 mb-8">
        <div className="md:col-span-2 md:row-span-2">
          <ContinueWritingCard
            project={lastProject}
          />
        </div>
        <QuickStartCard templates={templates} />
        <StatsCard
          totalProjects={projects.length}
          totalChapters={totalChapters}
          completedChapters={completedChapters}
        />
      </div>

      {/* Regular Project Grid (remaining projects) */}
      {remainingProjects.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {remainingProjects.map((p, i) => (
            <motion.div
              key={p.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                delay: i * 0.05,
                duration: 0.25,
                ease: [0.16, 1, 0.3, 1],
              }}
              className="relative group"
            >
              <Link href={`/projects/${p.id}`}>
                <Card className="hover:border-brand-200 dark:hover:border-brand-800 hover:shadow-sm transition-all duration-200">
                  <CardHeader>
                    <div className="flex items-start gap-2">
                      <BookOpen className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
                      <CardTitle className="group-hover:text-primary transition-colors">
                        {p.title ?? p.name}
                      </CardTitle>
                    </div>
                    <CardDescription className="line-clamp-2">
                      {p.topic}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {formatDistanceToNow(new Date(p.createdAt), {
                        addSuffix: true,
                        locale: enUS,
                      })}
                    </span>
                  </CardContent>
                </Card>
              </Link>
              <Button
                variant="ghost"
                size="icon"
                className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive hover:bg-destructive/10 z-10"
                onClick={(e) => {
                  e.preventDefault();
                  deleteProject(p.id, p.name);
                }}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add app/projects/page.tsx
git commit -m "feat: bento grid hero row, guided empty state, skeleton loading"
```

---

### Task 13: Update ProjectCard — Density Styling

**Files:**
- Modify: `components/patterns/project-card.tsx`

- [ ] **Step 1: Apply density-aware spacing**

Update `components/patterns/project-card.tsx` to use CSS variables for padding:

The card's `CardHeader` and `CardContent` currently use `p-6`. Update to use density variables via Tailwind arbitrary values:

```tsx
"use client";

import Link from "next/link";
import { motion } from "motion/react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { BookOpen, Clock } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";

export function ProjectCard({
  project,
  index,
}: {
  project: {
    id: string;
    name: string;
    topic: string;
    title: string | null;
    createdAt: Date;
  };
  index: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        delay: index * 0.05,
        duration: 0.25,
        ease: [0.16, 1, 0.3, 1],
      }}
    >
      <Link href={`/projects/${project.id}`}>
        <Card className="hover:border-brand-200 dark:hover:border-brand-800 hover:shadow-sm transition-all duration-200 group">
          <CardHeader style={{ padding: `calc(var(--density-card-padding-y)) calc(var(--density-card-padding-x))` }}>
            <div className="flex items-start justify-between gap-2">
              <CardTitle className="group-hover:text-primary transition-colors">
                {project.title ?? project.name}
              </CardTitle>
              <BookOpen className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
            </div>
            <CardDescription className="line-clamp-2">
              {project.topic}
            </CardDescription>
          </CardHeader>
          <CardContent
            className="flex items-center gap-3 text-xs text-muted-foreground"
            style={{ padding: `0 calc(var(--density-card-padding-x)) calc(var(--density-card-padding-y))` }}
          >
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {formatDistanceToNow(project.createdAt, {
                addSuffix: true,
                locale: es,
              })}
            </span>
          </CardContent>
        </Card>
      </Link>
    </motion.div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/patterns/project-card.tsx
git commit -m "feat: add density-aware spacing to project card"
```

---

### Task 14: Verify — Typecheck + Build

**Files:**
- None (verification only)

- [ ] **Step 1: Run typecheck**

```bash
pnpm typecheck
```

Expected: Pass with 0 errors. If errors found, fix them before proceeding.

- [ ] **Step 2: Run build**

```bash
pnpm build
```

Expected: Successful production build. If errors found, fix them before proceeding.

- [ ] **Step 3: Commit any fixes**

If fixes were needed:
```bash
git add -A
git commit -m "fix: type and build fixes for UI modernization"
```

---

## Verification Checklist

After all tasks complete:

- [ ] `pnpm typecheck` passes
- [ ] `pnpm build` succeeds
- [ ] Light mode: Lora body text visible, Geist Sans headings visible
- [ ] Dark mode: all components render with correct dark tokens
- [ ] Sidebar collapses to 56px icons-only, expands to 240px
- [ ] Sidebar persistence: collapse state survives page refresh
- [ ] Mobile: sidebar becomes drawer overlay
- [ ] Density toggle: compact mode reduces card padding ~40%
- [ ] Density persistence: survives page refresh
- [ ] Bento hero row: ContinueWriting (2-col), QuickStart, Stats render
- [ ] Empty state: renders when 0 projects, disappears after creation
- [ ] Skeleton loading: ProjectCardSkeleton geometry matches ProjectCard
- [ ] Navbar: only shows user email + logout, no nav links
- [ ] Auth pages: no sidebar, no navbar (existing behavior preserved)
