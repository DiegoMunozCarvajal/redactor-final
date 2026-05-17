"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function GenerateButton({ projectId }: { projectId: string }) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleGenerate() {
    setLoading(true);
    const res = await fetch(`/api/projects/${projectId}/generate`, { method: "POST" });
    const run = await res.json();
    if (res.ok) {
      router.push(`/projects/${projectId}/runs/${run.id}`);
    } else {
      alert(run.error ?? "Error generating");
    }
    setLoading(false);
  }

  return (
    <button
      onClick={handleGenerate}
      disabled={loading}
      className="px-6 py-3 bg-primary text-primary-foreground rounded-md font-medium disabled:opacity-50"
    >
      {loading ? "Starting..." : "Generar Libro"}
    </button>
  );
}
