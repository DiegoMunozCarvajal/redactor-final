# Global Navigation — Design Spec

**Date:** 2026-05-17
**Status:** approved

## Summary

Add consistent global navigation (top navbar + breadcrumbs) across all UI routes. Current state: only admin layout has a minimal header, projects area has no navigation.

## Design

### Navbar (root layout)

Top bar fixed at top of all authenticated pages.

- **Left:** App name "Redactor" (links to `/projects`) + nav links: Projects, Admin
- **Right:** User dropdown — email + Logout
- Hidden on auth routes (`/login`, `/signup`, `/forgot-password`, `/reset-password`, `/callback`).

Implementation:
- New `components/ui/navbar.tsx` — client component (needs `useRouter`, user state)
- Wraps in a client boundary; fetches user via Supabase browser client
- Checks `window.location.pathname` to hide on `/login`, etc. (or use `usePathname`)
- Renders in root `app/layout.tsx` inside `<ThemeProvider>`, after `<body>`.

### Breadcrumbs

Reusable `components/ui/breadcrumbs.tsx` — server or client component.

- Receives `items: { label: string; href?: string }[]`
- Renders: `Home > Section > Current` where last item is plain text (no link)
- Uses shadcn/ui breadcrumb pattern (chevron separators via `lucide-react`)

Usage per page:
- `/projects/[id]` → `[{ label: "Projects", href: "/projects" }, { label: project.name }]`
- `/projects/[id]/runs/[runId]` → `[{ label: "Projects", href: "/projects" }, { label: project.name, href: "/projects/[id]" }, { label: "Run" }]`
- `/admin/books/[id]` → `[{ label: "Admin", href: "/admin/books" }, { label: template.name }]`
- `/admin/books/[id]/chapters/[chapterId]` → `[{ label: "Admin", href: "/admin/books" }, { label: template.name, href: "/admin/books/[id]" }, { label: chapter.title }]`

### Admin layout simplification

Remove current inline `<header>` from `app/admin/layout.tsx`. Admin nav lives in global navbar now.

### Auth pages

No navbar, no breadcrumbs. Auth pages keep their minimal design.

## Files changed

| File | Change |
|------|--------|
| `components/ui/navbar.tsx` | **New** — global top navbar |
| `components/ui/breadcrumbs.tsx` | **New** — breadcrumb component |
| `app/layout.tsx` | Add `<Navbar />` inside body |
| `app/admin/layout.tsx` | Remove inline header |
| `app/projects/[id]/page.tsx` | Add breadcrumbs |
| `app/projects/[id]/runs/[runId]/page.tsx` | Add breadcrumbs |
| `app/admin/books/[id]/page.tsx` | Add breadcrumbs |
| `app/admin/books/[id]/chapters/[chapterId]/page.tsx` | Add breadcrumbs |

## Dependencies

- `lucide-react` — ChevronRight icon for breadcrumbs (already in project)
- `@radix-ui/react-dropdown-menu` — User menu (already in project)
- Supabase browser client — getUser for navbar user info (already exists)

## Non-goals

- Mobile responsive sidebar/hamburger — v2 if needed
- Active link highlighting — nice to have, not in v1
- Role-based nav visibility — no roles exist yet
