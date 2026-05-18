# Layout Shell — Spec

**Date**: 2026-05-17
**Status**: Approved
**Subsystem**: 2 of 7 (UI Overhaul)
**Depends on**: 1 — Design System Foundation ✅

## Context

Current Navbar is functional but basic: `border-b px-6 py-3`, plain text links, no backdrop blur, no active states. Admin uses a flat layout with no local navigation — navigating chapters/prompts requires bouncing between pages. This spec defines the shell: navbar, breadcrumbs, and admin contextual sidebar.

## Design Decisions

| Decision | Choice |
|----------|--------|
| Navbar style | Sticky, backdrop-blur, bg-background/80 |
| Navbar height | h-14 (56px) |
| Admin nav | Collapsible sidebar (zustand store) |
| Sidebar width | w-56 expanded (224px), w-12 collapsed (48px) |
| Projects layout | Navbar only, no sidebar |

## Navbar (`components/patterns/navbar.tsx`)

Refactor from current `components/ui/navbar.tsx`. Keep same auth logic, upgrade visuals:

```
┌──────────────────────────────────────────────────┐
│ 📖 Redactor  ·  Projects  Admin         user@.. ▾│
└──────────────────────────────────────────────────┘
```

- **Sticky**: `sticky top-0 z-50`
- **Blur**: `backdrop-blur-md bg-background/80`
- **Border**: `border-b border-neutral-200` (dark: `border-neutral-800`)
- **Height**: `h-14`
- **Padding**: `px-6`
- **Logo**: "Redactor" con ícono BookOpen (lucide), `font-semibold tracking-tight`
- **Nav links**: Projects, Admin — `text-sm font-medium text-muted-foreground hover:text-foreground transition-colors`. Active: `text-foreground` con underline indicator sutil
- **User menu**: Dropdown con email + Logout. Trigger: `text-sm text-muted-foreground`
- **Hide on auth pages**: misma lógica actual (check pathname)

## Breadcrumbs (`components/ui/breadcrumbs.tsx`)

Ya existe. Solo verificar que herede tokens nuevos correctamente:
- Links: `text-muted-foreground hover:text-foreground`
- Último item: `text-foreground font-medium`
- Separador: `text-muted-foreground/50`

## Admin Sidebar (`components/patterns/admin-sidebar.tsx`)

Solo en `/admin/*`. Estado en zustand:

```tsx
// lib/stores/sidebar.ts
import { create } from "zustand"

export const useSidebar = create<{
  collapsed: boolean
  toggle: () => void
}>((set) => ({
  collapsed: false,
  toggle: () => set((s) => ({ collapsed: !s.collapsed })),
}))
```

Sidebar:
- **Expandido**: `w-56`, muestra ícono + label + chevron
- **Colapsado**: `w-12`, solo íconos, tooltips en hover
- **Toggle**: botón en navbar o sidebar header
- **Items**: lista de chapters (en admin book detail). Item activo: `bg-accent text-accent-foreground`
- **Animación**: `motion.div` con `animate={{ width }}` + `transition={{ duration: 0.2, ease: [0.16,1,0.3,1] }}`
- **Sticky**: `sticky top-14` (debajo del navbar)
- **Altura**: `h-[calc(100vh-3.5rem)]`

### Admin Layout Shell

```
app/admin/layout.tsx
┌──────────────────────────────────────────────┐
│ Navbar (global, sticky)                      │
├─────────────┬────────────────────────────────┤
│ Sidebar     │ Breadcrumbs                    │
│ (admin)     │ ────────────────────────────── │
│             │ {children}                     │
│ Chapters:   │                                │
│ · Cap 1 ●   │                                │
│ · Cap 2     │                                │
│ · Cap 3     │                                │
└─────────────┴────────────────────────────────┘
```

## Files to Create

- `components/patterns/navbar.tsx` — refactored Navbar
- `components/patterns/admin-sidebar.tsx` — admin contextual sidebar
- `lib/stores/sidebar.ts` — zustand sidebar store

## Files to Modify

- `app/admin/layout.tsx` — add sidebar + breadcrumbs wrapper
- `app/layout.tsx` — import new Navbar from `components/patterns/navbar`
- `components/ui/navbar.tsx` — mark deprecated (redirect to patterns/navbar) or remove

## Files NOT to Modify

- `components/ui/breadcrumbs.tsx` — works, inherits new tokens
- All page components — only layout wrappers change
- API routes, lib/db, trigger

## Success Criteria

- [ ] Navbar sticky con backdrop-blur en todas las páginas
- [ ] Nav links muestran active state
- [ ] Sidebar aparece solo en `/admin/*`
- [ ] Sidebar colapsable con animación suave (Motion)
- [ ] Breadcrumbs funcionales en admin + projects
- [ ] Layout responsive — sidebar colapsado en mobile
- [ ] Typecheck pasa, build compila
