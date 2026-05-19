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
} from "lucide-react";
import { useDensity } from "@/lib/hooks/use-density";
import { cn } from "@/lib/utils";

const SIDEBAR_KEY = "sidebar-collapsed";
const MOBILE_BREAKPOINT = 768;

const NAV_ITEMS = [
  { href: "/projects", label: "Projects", icon: BookOpen },
  { href: "/templates", label: "Templates", icon: Layers },
];

function getStoredCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(SIDEBAR_KEY) === "true";
}

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
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

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(SIDEBAR_KEY, String(next));
      return next;
    });
  }, []);

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
                pathname={pathname}
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
        pathname={pathname}
        collapsed={collapsed}
        density={density}
        onToggleCollapse={toggleCollapsed}
        onToggleDensity={toggleDensity}
      />
    </motion.aside>
  );
}

function SidebarContent({
  pathname,
  collapsed,
  density,
  onToggleCollapse,
  onToggleDensity,
}: {
  pathname: string;
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
      <nav className="flex-1 py-2 px-2 space-y-1">
        {NAV_ITEMS.map((item) => {
          const active = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center rounded-md transition-colors text-sm font-medium",
                collapsed ? "justify-center px-0 py-2" : "px-3 py-2 gap-3",
                active
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
              )}
              title={collapsed ? item.label : undefined}
            >
              <item.icon className="h-4 w-4 shrink-0" />
              {!collapsed && <span className="whitespace-nowrap">{item.label}</span>}
            </Link>
          );
        })}
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
