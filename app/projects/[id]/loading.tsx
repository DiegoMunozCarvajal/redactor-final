export default function ProjectDetailLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="flex items-center gap-3">
        <div className="h-6 w-6 bg-muted rounded" />
        <div className="h-7 w-56 bg-muted rounded" />
      </div>
      <div className="rounded-lg border bg-card p-6 space-y-3">
        <div className="h-5 w-32 bg-muted rounded" />
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="flex items-center gap-3">
            <div className="h-4 w-20 bg-muted rounded" />
            <div
              className="h-4 bg-muted rounded"
              style={{ width: `${40 + (i % 3) * 15}%` }}
            />
            <div className="h-4 w-16 bg-muted rounded ml-auto" />
          </div>
        ))}
      </div>
    </div>
  );
}
