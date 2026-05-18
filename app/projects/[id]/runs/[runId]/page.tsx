"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";

interface ChapterRunData {
  id: string;
  position: number;
  status: string;
  assembledContent: string | null;
  fragments: { id: string; content: string | null }[];
}

export default function RunPage() {
  const params = useParams<{ id: string; runId: string }>();
  const [run, setRun] = useState<any>(null);
  const [chapterRuns, setChapterRuns] = useState<ChapterRunData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchRun() {
      const res = await fetch(`/api/runs/${params.runId}`);
      const data = await res.json();
      setRun(data);
      setChapterRuns(data.chapterRuns ?? []);
      setLoading(false);
    }
    fetchRun();
  }, [params.runId]);

  // Poll if running
  useEffect(() => {
    if (!run || run.status === "completed" || run.status === "failed") return;
    const interval = setInterval(async () => {
      const res = await fetch(`/api/runs/${params.runId}`);
      const data = await res.json();
      setRun(data);
      setChapterRuns(data.chapterRuns ?? []);
      if (data.status === "completed" || data.status === "failed") clearInterval(interval);
    }, 3000);
    return () => clearInterval(interval);
  }, [run?.status, params.runId]);

  if (loading) return <div className="p-6">Loading...</div>;

  return (
    <div className="max-w-4xl mx-auto p-6">
      <Breadcrumbs
        items={[
          { label: "Projects", href: "/projects" },
          { label: run.projectName ?? params.id, href: `/projects/${params.id}` },
          { label: `Run ${params.runId.slice(0, 8)}...` },
        ]}
      />
      <div className="flex items-center gap-3 mb-6">
        <h1 className="text-xl font-bold">Run {params.runId.slice(0, 8)}...</h1>
        <span className={`text-xs px-2 py-0.5 rounded ${
          run.status === "completed" ? "bg-green-100 text-green-800" :
          run.status === "failed" ? "bg-red-100 text-red-800" :
          run.status === "running" ? "bg-blue-100 text-blue-800" :
          "bg-muted"
        }`}>
          {run.status}
        </span>
      </div>

      {run.title && <h2 className="text-lg font-medium mb-2">{run.title}</h2>}
      {run.subtitle && <p className="text-muted-foreground mb-4">{run.subtitle}</p>}

      <div className="space-y-6">
        {chapterRuns.map((cr) => (
          <div key={cr.id} className="border rounded-lg p-4">
            <div className="flex items-center gap-2 mb-3">
              <span className="font-medium text-sm">Chapter {cr.position + 1}</span>
              <span className="text-xs text-muted-foreground">{cr.status}</span>
            </div>

            {cr.assembledContent ? (
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <ReactMarkdown>{cr.assembledContent}</ReactMarkdown>
              </div>
            ) : (
              <div className="space-y-2">
                {cr.fragments.map((f, i) => (
                  <div key={f.id} className="text-xs text-muted-foreground">
                    Fragment {i + 1}: {f.content ? `${f.content.slice(0, 100)}...` : "pending"}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
