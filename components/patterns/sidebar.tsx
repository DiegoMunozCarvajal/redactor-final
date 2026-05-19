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
  ChevronRight,
  FileText,
} from "lucide-react";
import { useDensity } from "@/lib/hooks/use-density";
import { cn } from "@/lib/utils";

const SIDEBAR_KEY = "sidebar-collapsed";
const MOBILE_BREAKPOINT = 768;

interface NavItem {
  href: string;
  label: string;
  icon: typeof BookOpen;
  active?: boolean;
  depth?: number;
}

const STATIC_ITEMS: NavItem[] = [
  { href: "/projects", label: "Projects", icon: BookOpen },
  { href: "/templates", label: "Templates", icon: Layers },
];

function getStoredCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(SIDEBAR_KEY) === "true";
}

// Parse pathname and return breadcrumb segments with IDs to resolve
interface PathSegment {
  type: "projects" | "templates" | "chapter" | "prompts";
  id?: string;
  parentId?: string; // projectId for chapters
}

function parsePathname(pathname: string): PathSegment[] {
  const segments: PathSegment[] = [];
  const parts = pathname.split("/").filter(Boolean);

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    switch (part) {
      case "projects":
        segments.push({ type: "projects" });
        // Next part could be a project ID
        if (parts[i + 1] && !["chapters"].includes(parts[i + 1])) {
          segments.push({ type: "projects", id: parts[i + 1] });
          i++;
        }
        break;
      case "templates":
        segments.push({ type: "templates" });
        if (parts[i + 1] && !["chapters"].includes(parts[i + 1])) {
          segments.push({ type: "templates", id: parts[i + 1] });
          i++;
        }
        break;
      case "chapters":
        if (parts[i + 1]) {
          const parentId = segments.length >= 2 && segments[segments.length - 1].type !== "projects" && segments[segments.length - 1].type !== "templates"
            ? segments.findLast((s) => s.id != null && (s.type === "projects" || s.type === "templates"))?.id
            : segments[segments.length - 1]?.id;
          segments.push({ type: "chapter", id: parts[i + 1], parentId });
          i++;
        }
        break;
      case "prompts":
        segments.push({ type: "prompts" });
        break;
    }
  }

  return segments;
}

// Fetch a name by API call
async function fetchName(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    return data.name ?? data.title ?? null;
  } catch {
    return null;
  }
}

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [resolvedLabels, setResolvedLabels] = useState<Record<string, string>>({});
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

  // Resolve breadcrumb names
  useEffect(() => {
    const segments = parsePathname(pathname);
    const toFetch: { key: string; url: string }[] = [];

    for (const seg of segments) {
      if (!seg.id) continue;
      const key = `${seg.type}:${seg.id}`;
      if (resolvedLabels[key]) continue;

      if (seg.type === "projects") {
        toFetch.push({ key, url: `/api/projects/${seg.id}` });
      } else if (seg.type === "templates") {
        toFetch.push({ key, url: `/api/books/${seg.id}` });
      } else if (seg.type === "chapter") {
        // Need the project ID for the chapter API
        const projectId = seg.parentId;
        if (projectId) {
          toFetch.push({ key, url: `/api/projects/${projectId}/chapters` });
        }
      }
    }

    if (toFetch.length === 0) return;

    let cancelled = false;

    Promise.all(
      toFetch.map(async ({ key, url }) => {
        // For chapters we use the chapters list and find by ID
        if (key.startsWith("chapter:")) {
          const chapterId = key.replace("chapter:", "");
          try {
            const res = await fetch(url);
            if (!res.ok) return { key, label: null };
            const chapters = await res.json();
            const chapter = chapters.find((ch: { id: string; title: string }) => ch.id === chapterId);
            return { key, label: chapter?.title ?? null };
          } catch {
            return { key, label: null };
          }
        }
        const label = await fetchName(url);
        return { key, label };
      })
    ).then((results) => {
      if (cancelled) return;
      setResolvedLabels((prev) => {
        const next = { ...prev };
        for (const { key, label } of results) {
          if (label) next[key] = label;
        }
        return next;
      });
    });

    return () => { cancelled = true; };
  }, [pathname]);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(SIDEBAR_KEY, String(next));
      return next;
    });
  }, []);

  // Build nav items from pathname
  const navItems = buildNavItems(pathname, resolvedLabels);

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
                navItems={navItems}
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
        navItems={navItems}
        collapsed={collapsed}
        density={density}
        onToggleCollapse={toggleCollapsed}
        onToggleDensity={toggleDensity}
      />
    </motion.aside>
  );
}

function buildNavItems(pathname: string, resolvedLabels: Record<string, string>): NavItem[] {
  const parts = pathname.split("/").filter(Boolean);

  // Always start with both static items
  const items: NavItem[] = STATIC_ITEMS.map((item) => {
    // Parent is active when on exact path OR when a child route is active
    const isParentActive = pathname === item.href || pathname.startsWith(item.href + "/");
    return { ...item, active: isParentActive };
  });

  if (parts.length < 2) return items;

  const rootType = parts[0] === "projects" || parts[0] === "templates" ? parts[0] : null;
  if (!rootType) return items;

  const entityId = parts[1];
  if (!entityId) return items;

  const entityKey = `${rootType}:${entityId}`;
  const entityLabel = resolvedLabels[entityKey] ?? "...";

  // Insert entity child right after its parent (index 0 for projects, 1 for templates)
  const parentIndex = rootType === "projects" ? 0 : 1;

  // Entity is active when on its page OR deeper (chapters, prompts)
  const entityPath = `/${rootType}/${entityId}`;
  const entityActive = pathname === entityPath || pathname.startsWith(entityPath + "/");

  items.splice(parentIndex + 1, 0, {
    href: entityPath,
    label: entityLabel,
    icon: FileText,
    depth: 1,
    active: entityActive,
  });

  // Chapters handling
  if (parts.length >= 4 && parts[2] === "chapters") {
    const chapterId = parts[3];
    const chapterKey = `chapter:${chapterId}`;
    const chapterLabel = resolvedLabels[chapterKey] ?? "...";

    items.splice(parentIndex + 2, 0, {
      href: `/${rootType}/${entityId}/chapters/${chapterId}`,
      label: chapterLabel,
      icon: FileText,
      depth: 2,
      active: parts.length === 4 || parts.length === 5,
    });

    if (parts.length === 5 && parts[4] === "prompts") {
      items.splice(parentIndex + 3, 0, {
        href: `/${rootType}/${entityId}/chapters/${chapterId}/prompts`,
        label: "Prompts",
        icon: ChevronRight,
        depth: 3,
        active: true,
      });
    }
  }

  return items;
}

function SidebarContent({
  navItems,
  collapsed,
  density,
  onToggleCollapse,
  onToggleDensity,
}: {
  navItems: NavItem[];
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
      <nav className="flex-1 py-2 px-2 space-y-1 overflow-y-auto">
        {navItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex items-center rounded-md transition-colors text-sm font-medium",
              collapsed ? "justify-center px-0 py-2" : "px-3 py-2 gap-3",
              item.depth && !collapsed ? `pl-${3 + (item.depth ?? 0) * 4}` : "",
              item.active
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
            )}
            style={
              item.depth && !collapsed
                ? { paddingLeft: `${12 + (item.depth ?? 0) * 16}px` }
                : undefined
            }
            title={collapsed ? item.label : undefined}
          >
            <item.icon className="h-4 w-4 shrink-0" />
            {!collapsed && (
              <span className="whitespace-nowrap truncate">{item.label}</span>
            )}
          </Link>
        ))}
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
