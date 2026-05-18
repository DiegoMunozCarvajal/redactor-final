"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";

interface ChapterRunData {
  id: string;
  position: number;
  status: string;
  assembledContent: string | null;
  fragments: { id: string; content: string | null }[];
}

interface RunData {
  id: string;
  status: string;
  title: string | null;
  subtitle: string | null;
  projectName?: string;
  chapterRuns: ChapterRunData[];
}

function statusBadge(status: string) {
  switch (status) {
    case "completed":
      return (
        <Badge className="bg-success/10 text-success border-success/20">
          Completado
        </Badge>
      );
    case "running":
      return (
        <Badge className="bg-info/10 text-info border-info/20">
          Generando
        </Badge>
      );
    case "failed":
      return <Badge variant="destructive">Fallido</Badge>;
    case "pending":
      return <Badge variant="outline">Pendiente</Badge>;
    default:
      return <Badge variant="secondary">{status}</Badge>;
  }
}

export default function RunPage() {
  const params = useParams<{ id: string; runId: string }>();
  const [run, setRun] = useState<RunData | null>(null);
  const [chapterRuns, setChapterRuns] = useState<ChapterRunData[]>([]);
  const [loading, setLoading] = useState(true);

  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function fetchRun() {
      try {
        const res = await fetch(`/api/runs/${params.runId}`);
        if (!res.ok) throw new Error(`Failed to load run (${res.status})`);
        const data = await res.json();
        if (!cancelled) {
          setRun(data);
          setChapterRuns(data.chapterRuns ?? []);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load run");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchRun();
    return () => { cancelled = true; };
  }, [params.runId]);

  // Poll if running
  useEffect(() => {
    if (!run || run.status === "completed" || run.status === "failed") return;
    let cancelled = false;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/runs/${params.runId}`);
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        setRun(data);
        setChapterRuns(data.chapterRuns ?? []);
        if (data.status === "completed" || data.status === "failed")
          clearInterval(interval);
      } catch {
        // polling continues — transient failures are tolerated
      }
    }, 3000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [run, params.runId]);

  if (loading)
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );

  if (error || !run) {
    return (
      <div className="max-w-4xl mx-auto p-6 text-center py-20">
        <p className="text-destructive mb-4">{error ?? "Run not found"}</p>
        <a href={`/projects/${params.id}`} className="text-sm text-primary hover:underline">
          Back to project
        </a>
      </div>
    );
  }

  const completedChapters = chapterRuns.filter(
    (cr) => cr.status === "completed"
  ).length;

  return (
    <div className="max-w-4xl mx-auto p-6">
      <Breadcrumbs
        items={[
          { label: "Projects", href: "/projects" },
          {
            label: run.projectName ?? params.id,
            href: `/projects/${params.id}`,
          },
          { label: `Run ${params.runId.slice(0, 8)}...` },
        ]}
      />

      <div className="flex items-center gap-3 mb-6 mt-4">
        <h1 className="text-xl font-bold">
          Run {params.runId.slice(0, 8)}...
        </h1>
        {statusBadge(run.status)}
      </div>

      {run.title && <h2 className="text-lg font-medium mb-2">{run.title}</h2>}
      {run.subtitle && (
        <p className="text-muted-foreground mb-4">{run.subtitle}</p>
      )}

      <div className="flex items-center gap-2 mb-6 text-sm text-muted-foreground">
        <span>
          {completedChapters}/{chapterRuns.length} chapters completed
        </span>
      </div>

      <div className="space-y-6">
        {chapterRuns.map((cr) => (
          <div key={cr.id} className="border rounded-lg p-4">
            <div className="flex items-center gap-2 mb-3">
              <span className="font-medium text-sm">
                Chapter {cr.position + 1}
              </span>
              <span className="text-xs text-muted-foreground">{cr.status}</span>
            </div>

            {cr.assembledContent ? (
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <ReactMarkdown>{cr.assembledContent}</ReactMarkdown>
              </div>
            ) : (
              <div className="space-y-2">
                {cr.fragments.map((f, i) => (
                  <div
                    key={f.id}
                    className="text-xs text-muted-foreground"
                  >
                    Fragment {i + 1}:{" "}
                    {f.content ? `${f.content.slice(0, 100)}...` : "pending"}
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
