"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
} from "@/components/ui/command"
import { BookOpen, Settings, Layout } from "lucide-react"

export function CommandPalette() {
  const router = useRouter()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    function down(e: KeyboardEvent) {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen((open) => !open)
      }
      if (e.key === "p" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        router.push("/projects")
      }
    }
    document.addEventListener("keydown", down)
    return () => document.removeEventListener("keydown", down)
  }, [router])

  function runCommand(callback: () => void) {
    setOpen(false)
    callback()
  }

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Type a command or search..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="Navigation">
          <CommandItem
            onSelect={() => runCommand(() => router.push("/projects"))}
          >
            <Layout className="h-4 w-4" />
            Projects
            <CommandShortcut>⌘P</CommandShortcut>
          </CommandItem>
          <CommandItem
            onSelect={() => runCommand(() => router.push("/templates"))}
          >
            <Settings className="h-4 w-4" />
            Templates
          </CommandItem>
        </CommandGroup>
        <CommandGroup heading="Create">
          <CommandItem
            onSelect={() => runCommand(() => router.push("/projects"))}
          >
            <BookOpen className="h-4 w-4" />
            New Project
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}
