"use client"

import { useSidebar } from "@/lib/stores/sidebar"
import { cn } from "@/lib/utils"
import { motion } from "motion/react"
import Link from "next/link"
import { usePathname } from "next/navigation"

type Chapter = {
  id: string
  title: string
  position: number
}

export function AdminSidebar({ chapters, bookId }: {
  chapters: Chapter[]
  bookId: string
}) {
  const { collapsed } = useSidebar()
  const pathname = usePathname()

  return (
    <motion.aside
      animate={{ width: collapsed ? 48 : 224 }}
      initial={{ width: 224 }}
      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
      className={cn(
        "sticky top-14 h-[calc(100vh-3.5rem)] shrink-0",
        "border-r border-border",
        "bg-background overflow-hidden"
      )}
    >
      <div className={cn("py-3", collapsed ? "px-1.5" : "px-3")}>
        {!collapsed && (
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider px-2 mb-2">
            Capítulos
          </p>
        )}
        <nav className="space-y-0.5">
          {chapters.map((ch) => {
            const href = `/admin/books/${bookId}/chapters/${ch.id}`
            const active = pathname === href || pathname.startsWith(href + "/")
            return (
              <Link
                key={ch.id}
                href={href}
                className={cn(
                  "flex items-center gap-2 rounded-md text-sm transition-colors",
                  collapsed ? "justify-center px-0 py-2" : "px-2 py-1.5",
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
