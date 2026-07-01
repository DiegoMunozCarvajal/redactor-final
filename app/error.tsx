"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Unhandled page error:", error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-center space-y-4">
        <h1 className="text-2xl font-semibold">Something went wrong</h1>
        <p className="text-muted-foreground text-sm">
          An unexpected error occurred. Please try again.
        </p>
        <Button onClick={reset} variant="outline">
          Try again
        </Button>
      </div>
    </div>
  );
}
