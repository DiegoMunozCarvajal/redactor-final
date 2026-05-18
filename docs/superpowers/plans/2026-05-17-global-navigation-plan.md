# Global Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add global top navbar + breadcrumbs across all UI routes for consistent navigation.

**Architecture:** Two new components (`Navbar`, `Breadcrumbs`) rendered in root layout. Navbar is a client component that checks auth state and hides on auth routes. Breadcrumbs is a server-compatible component that renders a link trail. Admin layout loses its inline header — nav lives in global navbar.

**Tech Stack:** Next.js 15, React 19, Supabase SSR (browser client), lucide-react, Tailwind CSS

---

### Task 1: Breadcrumbs component

**Files:**
- Create: `components/ui/breadcrumbs.tsx`

- [ ] **Step 1: Write the component**

```tsx
import Link from "next/link";
import { ChevronRight } from "lucide-react";

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

export function Breadcrumbs({ items }: { items: BreadcrumbItem[] }) {
  if (items.length === 0) return null;

  return (
    <nav className="flex items-center gap-1 text-sm text-muted-foreground mb-4">
      {items.map((item, i) => (
        <span key={i} className="flex items-center gap-1">
          {i > 0 && <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
          {item.href ? (
            <Link
              href={item.href}
              className="hover:text-foreground transition-colors truncate max-w-[200px]"
            >
              {item.label}
            </Link>
          ) : (
            <span className="text-foreground font-medium truncate max-w-[200px]">
              {item.label}
            </span>
          )}
        </span>
      ))}
    </nav>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
pnpm typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/ui/breadcrumbs.tsx
git commit -m "feat: add Breadcrumbs component"
```

---

### Task 2: Navbar component

**Files:**
- Create: `components/ui/navbar.tsx`

- [ ] **Step 1: Write the component**

```tsx
"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";
import { ChevronDown } from "lucide-react";

const AUTH_ROUTES = [
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/callback",
];

export function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<{ email?: string } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user ?? null);
    });
  }, []);

  // Close menu on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    if (menuOpen) document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [menuOpen]);

  if (AUTH_ROUTES.some((r) => pathname.startsWith(r))) return null;

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  }

  return (
    <header className="border-b px-6 py-3 flex items-center justify-between">
      <div className="flex items-center gap-4">
        <Link
          href="/projects"
          className="font-semibold hover:text-primary transition-colors"
        >
          Redactor
        </Link>
        <Link
          href="/projects"
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          Projects
        </Link>
        <Link
          href="/admin/books"
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          Admin
        </Link>
      </div>

      <div ref={menuRef} className="relative">
        <button
          onClick={() => setMenuOpen(!menuOpen)}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          {user?.email ?? "..."}
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
        {menuOpen && (
          <div className="absolute right-0 top-full mt-1 bg-background border rounded-md shadow-lg py-1 z-50 min-w-[120px]">
            <button
              onClick={handleLogout}
              className="block w-full text-left px-4 py-2 text-sm hover:bg-accent transition-colors"
            >
              Logout
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
pnpm typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/ui/navbar.tsx
git commit -m "feat: add Navbar component"
```

---

### Task 3: Add Navbar to root layout

**Files:**
- Modify: `app/layout.tsx`

- [ ] **Step 1: Import Navbar and wrap children**

Change `app/layout.tsx` body contents from:

```tsx
<ThemeProvider attribute="class" defaultTheme="system" enableSystem>
  {children}
  <Toaster />
</ThemeProvider>
```

To:

```tsx
<ThemeProvider attribute="class" defaultTheme="system" enableSystem>
  <Navbar />
  <main className="min-h-screen">{children}</main>
  <Toaster />
</ThemeProvider>
```

Add import after the existing imports:

```tsx
import { Navbar } from "@/components/ui/navbar";
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
pnpm typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/layout.tsx
git commit -m "feat: add Navbar to root layout"
```

---

### Task 4: Simplify admin layout

**Files:**
- Modify: `app/admin/layout.tsx`

- [ ] **Step 1: Remove inline header**

Replace the entire file content:

```tsx
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <main className="p-6">{children}</main>
    </div>
  );
}
```

Remove the `import Link from "next/link"` import since it's no longer used.

- [ ] **Step 2: Verify TypeScript compiles**

```bash
pnpm typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/admin/layout.tsx
git commit -m "refactor: remove admin inline header, now in global navbar"
```

---

### Task 5: Add breadcrumbs to project detail page

**Files:**
- Modify: `app/projects/[id]/page.tsx`

- [ ] **Step 1: Add breadcrumbs import and render**

Add import:
```tsx
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
```

Change the return JSX — add breadcrumbs before `<h1>`, wrapping the existing content. The top of the return becomes:

```tsx
return (
  <div className="max-w-3xl mx-auto p-6">
    <Breadcrumbs
      items={[
        { label: "Projects", href: "/projects" },
        { label: project.name },
      ]}
    />
    <h1 className="text-2xl font-bold mb-2">{project.name}</h1>
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
pnpm typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/projects/\[id\]/page.tsx
git commit -m "feat: add breadcrumbs to project detail page"
```

---

### Task 6: Add breadcrumbs to run page

**Files:**
- Modify: `app/projects/[id]/runs/[runId]/page.tsx`
- Modify: `app/api/runs/[id]/route.ts`

- [ ] **Step 1: Include project name in run API response**

In `app/api/runs/[id]/route.ts`, change the return line from:

```tsx
return NextResponse.json({ ...run, chapterRuns: chaptersWithFragments });
```

To:

```tsx
return NextResponse.json({
  ...run,
  projectName: project.name,
  chapterRuns: chaptersWithFragments,
});
```

- [ ] **Step 2: Add breadcrumbs to run page**

In `app/projects/[id]/runs/[runId]/page.tsx`:

Add import:
```tsx
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
```

The run state already has `projectName` after the API change. Add breadcrumbs before `<h1>`. Change the return JSX top to:

```tsx
return (
  <div className="max-w-4xl mx-auto p-6">
    <Breadcrumbs
      items={[
        { label: "Projects", href: "/projects" },
        { label: run.projectName ?? params.id, href: `/projects/${params.id}` },
        { label: `Run ${params.runId.slice(0, 8)}...` },
      ]}
    />
    <div className="flex items-center gap-3 mb-6">
      <h1 className="text-xl font-bold">Run {params.runId.slice(0, 8)}...</h1>
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
pnpm typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/projects/\[id\]/runs/\[runId\]/page.tsx app/api/runs/\[id\]/route.ts
git commit -m "feat: add breadcrumbs to run page"
```

---

### Task 7: Add breadcrumbs to admin book template page

**Files:**
- Modify: `app/admin/books/[id]/page.tsx`

- [ ] **Step 1: Add breadcrumbs import and render**

Add import:
```tsx
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
```

Change the return JSX — add breadcrumbs before `<h1>`:

```tsx
return (
  <div className="max-w-3xl mx-auto">
    <Breadcrumbs
      items={[
        { label: "Admin", href: "/admin/books" },
        { label: template.name },
      ]}
    />
    <h1 className="text-2xl font-bold mb-2">{template.name}</h1>
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
pnpm typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/admin/books/\[id\]/page.tsx
git commit -m "feat: add breadcrumbs to admin book template page"
```

---

### Task 8: Add breadcrumbs to admin chapter prompts page

**Files:**
- Modify: `app/admin/books/[id]/chapters/[chapterId]/page.tsx`

- [ ] **Step 1: Add breadcrumbs with chapter title**

This page is a client component. It already fetches the chapter title via `fetch(/api/chapters/${params.chapterId})`. We need the book template name too. Since the page already knows `params.id` (the book ID), fetch the book too. Add a `bookName` state.

Add import:
```tsx
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
```

Add state for book name:
```tsx
const [bookName, setBookName] = useState("");
```

Update the `useEffect` to also fetch the book:

```tsx
useEffect(() => {
  Promise.all([
    fetch(`/api/chapters/${params.chapterId}/prompts`)
      .then((r) => r.json())
      .then(setPrompts),
    fetch(`/api/chapters/${params.chapterId}`)
      .then((r) => r.json())
      .then((ch) => setChapterTitle(ch.title ?? "")),
    fetch(`/api/books/${params.id}`)
      .then((r) => r.json())
      .then((b) => setBookName(b.name ?? "")),
  ]).finally(() => setLoading(false));
}, [params.chapterId, params.id]);
```

Add breadcrumbs before `<h1>` in the return:

```tsx
return (
  <div className="max-w-4xl mx-auto">
    <Breadcrumbs
      items={[
        { label: "Admin", href: "/admin/books" },
        { label: bookName || "...", href: `/admin/books/${params.id}` },
        { label: chapterTitle || "..." },
      ]}
    />
    <h1 className="text-xl font-bold mb-6">{chapterTitle} — Prompts</h1>
```

- [ ] **Step 2: Check books API route exists**

```bash
ls app/api/books/\[id\]/route.ts
```

If it doesn't exist, create it with a GET handler that returns the book template by ID. Check if there's already one:

```bash
cat app/api/books/\[id\]/route.ts 2>/dev/null || echo "MISSING"
```

If MISSING, create `app/api/books/[id]/route.ts`:

```tsx
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { bookTemplates } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { eq } from "drizzle-orm";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const [book] = await db
    .select()
    .from(bookTemplates)
    .where(eq(bookTemplates.id, id))
    .limit(1);

  if (!book)
    return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(book);
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
pnpm typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/admin/books/\[id\]/chapters/\[chapterId\]/page.tsx
# If books API was created:
git add app/api/books/\[id\]/route.ts
git commit -m "feat: add breadcrumbs to chapter prompts editor page"
```

---

### Task 9: Final verification

- [ ] **Step 1: Run full typecheck**

```bash
pnpm typecheck
```

Expected: no errors.

- [ ] **Step 2: Run full test suite**

```bash
pnpm test
```

Expected: all tests pass.

- [ ] **Step 3: Start dev server and manually verify**

```bash
pnpm dev
```

Verify:
1. `/projects` — navbar visible (Redactor | Projects | Admin | user email)
2. `/projects/[id]` — navbar + breadcrumbs (Projects > name)
3. `/projects/[id]/runs/[runId]` — navbar + breadcrumbs (Projects > name > Run)
4. `/admin/books` — navbar visible
5. `/admin/books/[id]` — navbar + breadcrumbs (Admin > template name)
6. `/admin/books/[id]/chapters/[chapterId]` — navbar + breadcrumbs (Admin > template > chapter)
7. `/login` — navbar hidden
8. `/signup` — navbar hidden
9. User dropdown opens/closes, Logout works
