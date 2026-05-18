# Projects Dashboard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development

**Goal:** Redesign projects list, detail, and run viewer with modern cards, proper shadcn Dialog, Motion animations, URL state, skeletons, and semantic status badges.

**Architecture:** Server components for data fetching, client components for interactivity. nuqs for URL state (search/filter). Motion for staggered list animations. shadcn Dialog for create project modal. Skeleton components for loading states.

---

### Task 1: Redesign CreateProjectDialog with shadcn Dialog + react-hook-form

**Files:**
- Modify: `components/projects/create-project-dialog.tsx`

Replace current manual overlay/native inputs with shadcn Dialog + Input/Select/Button + react-hook-form + zod:

```tsx
"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { BookOpen, Loader2 } from "lucide-react"

const schema = z.object({
  name: z.string().min(1, "Required").max(100),
  topic: z.string().min(1, "Required").max(200),
  bookTemplateId: z.string().min(1, "Required"),
})

type FormData = z.infer<typeof schema>

export function CreateProjectDialog({ templates }: { templates: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false)
  const router = useRouter()
  const { register, handleSubmit, setValue, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
  })

  async function onSubmit(data: FormData) {
    const res = await fetch("/api/projects", {
      method: "POST",
      body: JSON.stringify(data),
      headers: { "Content-Type": "application/json" },
    })
    if (res.ok) {
      const project = await res.json()
      setOpen(false)
      router.push(`/projects/${project.id}`)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <BookOpen className="h-4 w-4" />
          New Project
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create Project</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Project Name</Label>
            <Input id="name" {...register("name")} placeholder="My Book" />
            {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="topic">Topic</Label>
            <Input id="topic" {...register("topic")} placeholder="History of AI" />
            {errors.topic && <p className="text-xs text-destructive">{errors.topic.message}</p>}
          </div>
          <div className="space-y-2">
            <Label>Book Template</Label>
            <Select onValueChange={(v) => setValue("bookTemplateId", v)}>
              <SelectTrigger>
                <SelectValue placeholder="Select a template..." />
              </SelectTrigger>
              <SelectContent>
                {templates.map((t) => (
                  <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.bookTemplateId && <p className="text-xs text-destructive">Required</p>}
          </div>
          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Create Project
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
```

Commit: `feat: redesign CreateProjectDialog with shadcn Dialog and react-hook-form`

---

### Task 2: Redesign projects list page

**Files:**
- Modify: `app/projects/page.tsx`
- Create: `components/patterns/project-card.tsx`

Current: basic `<div>` cards with simple text. New design:

**ProjectCard** (`components/patterns/project-card.tsx`):
```tsx
"use client"

import Link from "next/link"
import { motion } from "motion/react"
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { BookOpen, Clock } from "lucide-react"
import { formatDistanceToNow } from "date-fns"
import { es } from "date-fns/locale"

export function ProjectCard({ project, index }: { 
  project: { id: string; name: string; topic: string; createdAt: Date; _count?: { runs: number } }
  index: number 
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
    >
      <Link href={`/projects/${project.id}`}>
        <Card className="hover:border-brand-200 dark:hover:border-brand-800 hover:shadow-sm transition-all duration-200 group">
          <CardHeader>
            <div className="flex items-start justify-between gap-2">
              <CardTitle className="group-hover:text-primary transition-colors">
                {project.name}
              </CardTitle>
              <BookOpen className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
            </div>
            <CardDescription className="line-clamp-2">{project.topic}</CardDescription>
          </CardHeader>
          <CardContent className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {formatDistanceToNow(project.createdAt, { addSuffix: true, locale: es })}
            </span>
            {project._count && (
              <Badge variant="secondary" className="text-xs">
                {project._count.runs} {project._count.runs === 1 ? "run" : "runs"}
              </Badge>
            )}
          </CardContent>
        </Card>
      </Link>
    </motion.div>
  )
}
```

**Projects page** — update to use new card + empty state:
- Grid layout: `grid gap-4 md:grid-cols-2 lg:grid-cols-3`
- Empty state with icon + message + CTA
- Page heading with brand styling

Commit: `feat: redesign projects list with animated cards and empty state`

---

### Task 3: Redesign project detail page

**Files:**
- Modify: `app/projects/[id]/page.tsx`

Enhance with:
- Better header layout with project metadata
- Topic displayed in a prominent card
- Generate button more visible (large, icon)
- Runs displayed as timeline-style cards with status badges using semantic colors
- Each run card shows: status badge, timestamps, link to view

Commit: `feat: redesign project detail with timeline runs and semantic badges`

---

### Task 4: Enhance run viewer page

**Files:**
- Modify: `app/projects/[id]/runs/[runId]/page.tsx`

Enhance with:
- Better chapter navigation (sidebar-like list within page)
- Skeleton loading while fetching
- Chapter content with better prose styling
- Fragment previews collapsible
- Progress indicator during generation
- Status badge with semantic colors

Commit: `feat: enhance run viewer with chapter navigation and skeletons`

---

### Task 5: Build verification

1. `pnpm typecheck` — must pass
2. `pnpm build` — CSS must compile
3. Check pages render correctly

---

## Files to Modify
- `components/projects/create-project-dialog.tsx`
- `app/projects/page.tsx`
- `app/projects/[id]/page.tsx`
- `app/projects/[id]/runs/[runId]/page.tsx`

## Files to Create
- `components/patterns/project-card.tsx`

## Context

Design System Foundation ✅ (OKLCH tokens, Geist fonts, motion deps)
Layout Shell ✅ (Navbar with backdrop-blur, admin sidebar)
All new deps available: motion, nuqs, react-hook-form, zustand, date-fns

Work from: /Users/diegocarvajal/Documents/Programming/redactor-v4
