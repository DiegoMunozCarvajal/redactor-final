"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/browser";
import { useSidebar } from "@/lib/stores/sidebar";
import { BookOpen, ChevronDown, PanelLeftClose, PanelLeftOpen } from "lucide-react";

const AUTH_ROUTES = [
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/callback",
];

const supabase = createClient();

export function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [userResolved, setUserResolved] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const { collapsed, toggle } = useSidebar();

  useEffect(() => {
    supabase.auth
      .getUser()
      .then(({ data }) => {
        setUser(data.user ?? null);
      })
      .catch(() => setUser(null))
      .finally(() => setUserResolved(true));
  }, []);

  // Close menu on outside click
  useEffect(() => {
    function handleOutsideMousedown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    if (menuOpen) document.addEventListener("mousedown", handleOutsideMousedown);
    return () => document.removeEventListener("mousedown", handleOutsideMousedown);
  }, [menuOpen]);

  if (AUTH_ROUTES.includes(pathname)) return null;

  async function handleLogout() {
    const { error } = await supabase.auth.signOut();
    if (error) return;
    router.push("/login");
  }

  const isAdmin = pathname.startsWith("/admin");

  return (
    <header className="sticky top-0 z-50 border-b border-neutral-200 dark:border-neutral-800 backdrop-blur-md bg-background/80 h-14 px-6 flex items-center justify-between">
      <div className="flex items-center gap-4">
        <Link
          href="/projects"
          className="flex items-center gap-2 font-semibold tracking-tight hover:text-primary transition-colors"
        >
          <BookOpen className="h-5 w-5 text-brand-500" />
          Redactor
        </Link>

        <Link
          href="/projects"
          className={`text-sm font-medium transition-colors ${
            pathname.startsWith("/projects")
              ? "text-primary"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Projects
        </Link>
        <Link
          href="/admin/books"
          className={`text-sm font-medium transition-colors ${
            isAdmin
              ? "text-primary"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Admin
        </Link>

        {isAdmin && (
          <button
            onClick={toggle}
            className="text-muted-foreground hover:text-foreground transition-colors"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? (
              <PanelLeftOpen className="h-4 w-4" />
            ) : (
              <PanelLeftClose className="h-4 w-4" />
            )}
          </button>
        )}
      </div>

      {userResolved && (
        <div ref={menuRef} className="relative">
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            aria-expanded={menuOpen}
            aria-haspopup="true"
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            {user?.email ?? ""}
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
          {menuOpen && (
            <div
              role="menu"
              className="absolute right-0 top-full mt-1 bg-background border border-neutral-200 dark:border-neutral-800 rounded-lg shadow-lg py-1 z-50 min-w-[120px]"
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setMenuOpen(false);
                  e.stopPropagation();
                }
              }}
            >
              <button
                role="menuitem"
                onClick={handleLogout}
                className="block w-full text-left px-4 py-2 text-sm hover:bg-accent transition-colors"
              >
                Logout
              </button>
            </div>
          )}
        </div>
      )}
    </header>
  );
}
