# Layout Shell — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development

**Goal:** Refactor Navbar with backdrop-blur + active states, add collapsible admin sidebar (zustand + Motion), and wire admin layout shell.

**Architecture:** Navbar moves to `components/patterns/navbar.tsx` (pattern, not UI primitive). Admin sidebar uses zustand for collapse state + Motion for width animation. Admin layout wraps pages in sidebar + breadcrumbs + content shell.

**Tech Stack:** Next.js 15, Tailwind v4, Motion, zustand, lucide-react

---

### Task 1: Create zustand sidebar store

**Files:**
- Create: `lib/stores/sidebar.ts`

```tsx
import { create } from "zustand"

type SidebarState = {
  collapsed: boolean
  toggle: () => void
  setCollapsed: (collapsed: boolean) => void
}

export const useSidebar = create<SidebarState>((set) => ({
  collapsed: false,
  toggle: () => set((s) => ({ collapsed: !s.collapsed })),
  setCollapsed: (collapsed) => set({ collapsed }),
}))
```

Commit: `feat: add zustand sidebar store`

---

### Task 2: Refactor Navbar to patterns/navbar.tsx

**Files:**
- Create: `components/patterns/navbar.tsx`
- Modify: `app/layout.tsx` (change import path)

Read current `components/ui/navbar.tsx`, refactor to `components/patterns/navbar.tsx` with these changes:

1. **Wrapper**: `sticky top-0 z-50 border-b border-neutral-200 dark:border-neutral-800 backdrop-blur-md bg-background/80`
2. **Height**: `h-14` (change from current py-3)
3. **Logo**: `<BookOpen className="h-5 w-5 text-brand-500" />` + "Redactor" text with `font-semibold tracking-tight`
4. **Nav links**: active state detection via `usePathname()`. Active: `text-foreground`, Inactive: `text-muted-foreground hover:text-foreground`. Add subtle underline indicator on active (`after:absolute after:bottom-0 after:h-0.5 after:bg-brand-500`)
5. **User menu**: Keep existing dropdown logic, style trigger with `text-sm text-muted-foreground`
6. **Hide on auth routes**: keep existing logic
7. **Admin sidebar toggle**: Show `PanelLeftClose`/`PanelLeftOpen` icon button when on `/admin/*`

Keep all existing auth logic, getUser, sign out — only change styling and structure.

Update `app/layout.tsx`: change `import { Navbar } from "@/components/ui/navbar"` to `import { Navbar } from "@/components/patterns/navbar"`.

Commit: `feat: refactor Navbar with backdrop-blur, active states, and brand styling`

---

### Task 3: Create admin sidebar component

**Files:**
- Create: `components/patterns/admin-sidebar.tsx`

```tsx
"use client"

import { useSidebar } from "@/lib/stores/sidebar"
import { cn } from "@/lib/utils"
import { motion } from "motion/react"
import Link from "next/link"
import { usePathname } from "next/navigation"

// Props: chapters list for the current book
// Each chapter: { id, title, position }

export function AdminSidebar({ chapters, bookId }: {
  chapters: { id: string; title: string; position: number }[]
  bookId: string
}) {
  const { collapsed } = useSidebar()
  const pathname = usePathname()

  return (
    <motion.aside
      animate={{ width: collapsed ? 48 : 224 }}
      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
      className={cn(
        "sticky top-14 h-[calc(100vh-3.5rem)]",
        "border-r border-neutral-200 dark:border-neutral-800",
        "bg-background overflow-hidden"
      )}
    >
      <div className="p-3">
        {!collapsed && (
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider px-2 mb-2">
            Capítulos
          </p>
        )}
        <nav className="space-y-0.5">
          {chapters.map((ch) => {
            const href = `/admin/books/${bookId}/chapters/${ch.id}`
            const active = pathname === href || pathname.startsWith(href)
            return (
              <Link
                key={ch.id}
                href={href}
                className={cn(
                  "flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors",
                  active
                    ? "bg-accent text-accent-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                )}
              >
                <span className="text-xs tabular-nums w-5 text-center shrink-0">
                  {ch.position}
                </span>
                {!collapsed && (
                  <span className="truncate">{ch.title}</span>
                )}
              </Link>
            )
          })}
        </nav>
      </div>
    </motion.aside>
  )
}
```

Commit: `feat: add admin sidebar with collapsible animation`

---

### Task 4: Update admin layout with sidebar shell

**Files:**
- Modify: `app/admin/layout.tsx`

Read current layout. Replace with shell:

```tsx
import { AdminSidebar } from "@/components/patterns/admin-sidebar"
import { Breadcrumbs } from "@/components/ui/breadcrumbs"
import { db } from "@/lib/db/drizzle"
import { chapters } from "@/lib/db/schema"
import { eq } from "drizzle-orm"
import { notFound } from "next/navigation"

// Admin layout loads chapters for sidebar when on book detail pages
// We detect bookId from params or pathname
// For now: render children with breadcrumbs wrapper
// Sidebar populated in child pages that need it via props or parallel route

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[calc(100vh-3.5rem)]">
      {/* Sidebar slot — rendered by child pages that provide chapters */}
      <div className="shrink-0">
        {/* Book detail pages render AdminSidebar here via layout nesting */}
      </div>
      <div className="flex-1 min-w-0">
        <div className="px-6 py-4">
          <Breadcrumbs />
        </div>
        <main className="px-6 pb-12">
          {children}
        </main>
      </div>
    </div>
  )
}
```

**Alternative approach for sidebar data**: Instead of loading chapters in the layout (which needs bookId from params), create a nested layout at `app/admin/books/[id]/layout.tsx` that loads the book's chapters and renders `AdminSidebar`. This way the sidebar only appears on book detail pages.

Create `app/admin/books/[id]/layout.tsx`:

```tsx
import { AdminSidebar } from "@/components/patterns/admin-sidebar"
import { Breadcrumbs } from "@/components/ui/breadcrumbs"
import { db } from "@/lib/db/drizzle"
import { chapters } from "@/lib/db/schema/chapters"
import { eq } from "drizzle-orm"
import { notFound } from "next/navigation"

export default async function BookLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const bookChapters = await db
    .select({ id: chapters.id, title: chapters.title, position: chapters.position })
    .from(chapters)
    .where(eq(chapters.bookTemplateId, id))
    .orderBy(chapters.position)

  return (
    <div className="flex min-h-[calc(100vh-3.5rem)]">
      <AdminSidebar chapters={bookChapters} bookId={id} />
      <div className="flex-1 min-w-0">
        <div className="px-6 py-3">
          <Breadcrumbs />
        </div>
        <main className="px-6 pb-12">
          {children}
        </main>
      </div>
    </div>
  )
}
```

The existing `app/admin/books/[id]/page.tsx` remains unchanged — it renders inside this layout.

Commit: `feat: add admin layout shell with sidebar and breadcrumbs`

---

### Task 5: Build verification

1. `pnpm typecheck` — must pass
2. `pnpm build` — CSS must compile (pre-existing ESLint errors are OK)
3. Visual check: Navbar with backdrop-blur, active nav links, sidebar in admin

---

## Completion Checklist

- [ ] Navbar sticky with backdrop-blur on all pages
- [ ] Nav links show active state
- [ ] Admin sidebar visible on `/admin/books/[id]/*`
- [ ] Sidebar collapses/expands with animation
- [ ] Sidebar toggle button in Navbar on admin pages
- [ ] Breadcrumbs render in admin layout
- [ ] `pnpm typecheck` passes
- [ ] `pnpm build` CSS compiles
