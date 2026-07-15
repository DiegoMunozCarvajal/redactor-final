"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { BookOpen, Loader2 } from "lucide-react"
import { toast } from "sonner"

const schema = z.object({
  name: z.string().min(1, "Required").max(100),
  title: z.string().max(300).optional(),
})

type FormData = z.infer<typeof schema>

export function CreateProjectDialog({
  templates,
  trigger,
  onOpenChange,
}: {
  templates: { id: string; name: string; status: string }[]
  trigger?: React.ReactNode
  onOpenChange?: (open: boolean) => void
}) {
  const [open, setOpen] = useState(false)
  const [bookTemplateId, setBookTemplateId] = useState<string | null>(null)
  const router = useRouter()

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
  })

  function handleOpenChange(open: boolean) {
    setOpen(open)
    onOpenChange?.(open)
  }

  async function onSubmit(data: FormData) {
    try {
      const body: { name: string; title?: string; bookTemplateId?: string } = { name: data.name }
      if (data.title?.trim()) {
        body.title = data.title.trim()
      }
      if (bookTemplateId) {
        body.bookTemplateId = bookTemplateId
      }
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (res.ok) {
        router.push(`/projects/${json.id}`)
        setOpen(false)
        setBookTemplateId(null)
      } else {
        toast.error(json.error ?? "Error creating project")
      }
    } catch {
      toast.error("Network error. Please try again.")
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button>
            <BookOpen className="h-4 w-4" />
            New Project
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New Project</DialogTitle>
          <DialogDescription>Create a new book generation project.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Project Name</Label>
            <Input
              id="name"
              placeholder="My Book Project"
              {...register("name")}
            />
            <p className="text-[10px] text-muted-foreground">Internal name to identify your project.</p>
            {errors.name && (
              <p className="text-xs text-destructive">{errors.name.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="title">Book Title (optional)</Label>
            <Input
              id="title"
              placeholder="Hábitos Atómicos"
              {...register("title")}
            />
            <p className="text-[10px] text-muted-foreground">The title of your book. Can be set later.</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="bookTemplateId">Book Template (optional)</Label>
            <Select
              value={bookTemplateId ?? "__none__"}
              onValueChange={(v) =>
                setBookTemplateId(v === "__none__" ? null : v)
              }
            >
              <SelectTrigger id="bookTemplateId">
                <SelectValue placeholder="No template (start from scratch)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">No template (start from scratch)</SelectItem>
                {templates.map((t) => {
                  const isGenerating = t.status === "generating";
                  const isFailed = t.status === "failed";
                  const isDisabled = isGenerating || isFailed;
                  return (
                    <SelectItem key={t.id} value={t.id} disabled={isDisabled}>
                      <span className="flex items-center gap-2">
                        {t.name}
                        {isGenerating && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 animate-pulse">
                            Generating...
                          </span>
                        )}
                        {isFailed && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-destructive/10 text-destructive">
                            Failed
                          </span>
                        )}
                      </span>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>

          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Create Project
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
