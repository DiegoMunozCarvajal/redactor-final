"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/browser";
import { ChevronDown } from "lucide-react";

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

  return (
    <header className="border-b px-6 py-3 flex items-center justify-between">
      <div className="flex items-center gap-4">
        <Link
          href="/projects"
          className="font-semibold hover:text-primary transition-colors"
        >
          Redactor
        </Link>
        <Link
          href="/projects"
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          Projects
        </Link>
        <Link
          href="/admin/books"
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          Admin
        </Link>
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
              className="absolute right-0 top-full mt-1 bg-background border rounded-md shadow-lg py-1 z-50 min-w-[120px]"
              onKeyDown={(e) => { if (e.key === "Escape") { setMenuOpen(false); e.stopPropagation(); } }}
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
