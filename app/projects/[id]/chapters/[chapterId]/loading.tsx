export default function ChapterLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="h-6 w-6 bg-muted rounded" />
        <div className="h-7 w-64 bg-muted rounded" />
      </div>

      {/* Content skeleton */}
      <div className="rounded-lg border bg-card p-6 space-y-4">
        <div className="h-5 w-32 bg-muted rounded" />
        <div className="space-y-2">
          <div className="h-4 bg-muted rounded w-full" />
          <div className="h-4 bg-muted rounded w-[95%]" />
          <div className="h-4 bg-muted rounded w-[88%]" />
          <div className="h-4 bg-muted rounded w-[92%]" />
          <div className="h-4 bg-muted rounded w-[85%]" />
        </div>
      </div>

      {/* Placeholders skeleton */}
      <div className="rounded-lg border bg-card p-6 space-y-3">
        <div className="h-5 w-40 bg-muted rounded" />
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="flex items-center gap-3">
            <div className="h-4 w-24 bg-muted rounded" />
            <div className="h-4 flex-1 bg-muted rounded" />
          </div>
        ))}
      </div>

      {/* Actions skeleton */}
      <div className="flex gap-3">
        <div className="h-9 w-28 bg-muted rounded" />
        <div className="h-9 w-36 bg-muted rounded" />
      </div>
    </div>
  );
}
