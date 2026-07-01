import Link from "next/link";

export default function NotFoundPage() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-center space-y-4">
        <h1 className="text-2xl font-semibold">Page not found</h1>
        <p className="text-muted-foreground text-sm">
          The page you are looking for does not exist.
        </p>
        <Link
          href="/projects"
          className="text-sm text-primary underline underline-offset-4 hover:text-primary/80"
        >
          Go to projects
        </Link>
      </div>
    </div>
  );
}
