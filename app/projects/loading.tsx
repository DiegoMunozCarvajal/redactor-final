export default function ProjectsLoading() {
  return (
    <div className="space-y-4">
      <div className="h-8 w-48 bg-muted rounded animate-pulse" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <div
            key={i}
            className="rounded-lg border bg-card p-6 animate-pulse"
            style={{ animationDelay: `${i * 100}ms` }}
          >
            <div className="flex items-start gap-2">
              <div className="h-5 w-5 bg-muted rounded shrink-0 mt-0.5" />
              <div className="flex-1 space-y-3">
                <div
                  className="h-5 bg-muted rounded"
                  style={{ width: `${60 + (i % 3) * 12}%` }}
                />
                <div
                  className="h-4 bg-muted rounded"
                  style={{ width: `${80 + (i % 2) * 10}%` }}
                />
              </div>
            </div>
            <div
              className="h-3 bg-muted rounded mt-4"
              style={{ width: `${30 + (i % 3) * 8}%` }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
