export default function GenerationLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="flex items-center justify-between">
        <div className="h-7 w-48 bg-muted rounded" />
        <div className="h-9 w-32 bg-muted rounded" />
      </div>
      <div className="rounded-lg border bg-card p-6 space-y-4">
        {Array.from({ length: 3 }, (_, i) => (
          <div
            key={i}
            className="flex items-center justify-between py-2"
          >
            <div className="space-y-2 flex-1">
              <div className="h-5 bg-muted rounded w-48" />
              <div className="h-4 bg-muted rounded w-96" />
            </div>
            <div className="flex gap-2">
              <div className="h-8 w-16 bg-muted rounded" />
              <div className="h-8 w-16 bg-muted rounded" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
