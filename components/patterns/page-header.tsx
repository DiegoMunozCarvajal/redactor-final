import { cn } from "@/lib/utils";
import { Breadcrumbs, type BreadcrumbItem } from "@/components/ui/breadcrumbs";

interface PageHeaderProps {
  breadcrumbs?: BreadcrumbItem[];
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
  className?: string;
}

export function PageHeader({
  breadcrumbs,
  title,
  subtitle,
  children,
  className,
}: PageHeaderProps) {
  const hasBreadcrumbs = breadcrumbs && breadcrumbs.length > 0;

  return (
    <div className={cn("mb-6", className)}>
      {hasBreadcrumbs && <Breadcrumbs items={breadcrumbs} />}
      <div
        className={cn(
          "flex items-center justify-between",
          hasBreadcrumbs && "mt-4"
        )}
      >
        <div>
          <h1 className="text-2xl font-bold">{title}</h1>
          {subtitle && (
            <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>
          )}
        </div>
        {children && <div className="flex items-center gap-2">{children}</div>}
      </div>
    </div>
  );
}
