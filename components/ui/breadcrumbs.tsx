import * as React from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

export interface BreadcrumbsProps {
  items: BreadcrumbItem[];
  className?: string;
}

export function Breadcrumbs({ items, className }: BreadcrumbsProps) {
  if (items.length === 0) return null;

  return (
    <nav
      aria-label="Breadcrumb"
      className={cn(
        "flex items-center gap-1 text-sm text-muted-foreground mb-4",
        className
      )}
    >
      {items.map((item, i) => (
        <span key={item.label} className="flex items-center gap-1 max-w-[200px]">
          {i > 0 && <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
          {item.href ? (
            <Link
              href={item.href}
              className="hover:text-foreground transition-colors truncate min-w-0"
            >
              {item.label}
            </Link>
          ) : (
            <span className="text-foreground font-medium truncate min-w-0">
              {item.label}
            </span>
          )}
        </span>
      ))}
    </nav>
  );
}
