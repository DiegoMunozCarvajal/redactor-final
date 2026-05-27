import { cn } from "@/lib/utils";

interface LoadingSkeletonProps {
  count?: number;
  className?: string;
  itemClassName?: string;
}

export function LoadingSkeleton({
  count = 3,
  className,
  itemClassName,
}: LoadingSkeletonProps) {
  return (
    <div className={cn("animate-pulse space-y-4", className)}>
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className={cn("h-24 bg-muted rounded-lg", itemClassName)}
        />
      ))}
    </div>
  );
}
