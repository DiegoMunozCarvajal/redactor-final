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
  topic: z.string().min(1, "Required").max(200),
})

type FormData = z.infer<typeof schema>

export function CreateProjectDialog({
  templates,
}: {
  templates: { id: string; name: string }[]
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

  async function onSubmit(data: FormData) {
    try {
      const body: { name: string; topic: string; bookTemplateId?: string } = data
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
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <BookOpen className="h-4 w-4" />
          New Project
        </Button>
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
              placeholder="My Book"
              {...register("name")}
            />
            {errors.name && (
              <p className="text-xs text-destructive">{errors.name.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="topic">Topic</Label>
            <Input
              id="topic"
              placeholder="History of Artificial Intelligence"
              {...register("topic")}
            />
            {errors.topic && (
              <p className="text-xs text-destructive">{errors.topic.message}</p>
            )}
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
                {templates.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
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
