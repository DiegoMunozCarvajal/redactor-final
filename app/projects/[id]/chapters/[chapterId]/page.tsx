"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card";
import {
  Loader2,
  BookOpen,
  Clock,
  ChevronRight,
  AlertTriangle,
  Pencil,
  Check,
  X,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";

interface FragmentData {
  id: string;
  position: number;
  content: string | null;
  modelUsed: string | null;
  tokensUsed: number | null;
  type: string | null;
}

interface GenerationData {
  id: string;
  status: string;
  assembledContent: string | null;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
  fragments: FragmentData[];
}

interface ChapterDetail {
  projectName: string;
  projectTopic: string;
  chapter: {
    id: string;
    position: number;
    title: string;
  };
  generations: GenerationData[];
}

function statusBadge(status: string) {
  switch (status) {
    case "completed":
      return <Badge className="bg-success/10 text-success border-success/20">Completado</Badge>;
    case "generating":
      return <Badge className="bg-info/10 text-info border-info/20">Generando</Badge>;
    case "failed":
      return <Badge variant="destructive">Fallido</Badge>;
    default:
      return <Badge variant="secondary">{status}</Badge>;
  }
}

const FRAGMENT_LABELS: Record<string, string> = {
  apertura: "Apertura",
  modelo: "Modelo",
  contraste: "Contraste",
  amplificacion: "Amplificación",
  anécdota: "Anécdota",
  acumulación: "Acumulación",
  proceso: "Proceso",
  cierre: "Cierre",
};

export default function ChapterPage() {
  const params = useParams<{ id: string; chapterId: string }>();
  const router = useRouter();
  const [data, setData] = useState<ChapterDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedGen, setExpandedGen] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const fetchingRef = useRef(false);

  const fetchChapter = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch(
        `/api/projects/${params.id}/chapters/${params.chapterId}`,
        { signal },
      );
      if (signal?.aborted) return;
      if (!res.ok) throw new Error(`Failed to load (${res.status})`);
      setData(await res.json());
    } catch (err) {
      if (signal?.aborted) return;
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  }, [params.id, params.chapterId]);

  useEffect(() => {
    const controller = new AbortController();
    fetchChapter(controller.signal);
    return () => controller.abort();
  }, [fetchChapter]);

  async function saveChapterTitle() {
    if (!data) return;
    const res = await fetch(`/api/projects/${params.id}/chapters/${params.chapterId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: editTitle }),
    });
    if (res.ok) {
      setData({
        ...data,
        chapter: { ...data.chapter, title: editTitle },
      });
      setEditingTitle(false);
    } else {
      toast.error("Error saving chapter title");
    }
  }

  async function deleteChapter() {
    if (!data) return;
    if (!confirm(`Delete "${data.chapter.title}"?`)) return;
    const res = await fetch(`/api/projects/${params.id}/chapters/${params.chapterId}`, {
      method: "DELETE",
    });
    if (res.ok) {
      router.push(`/projects/${params.id}`);
    } else {
      toast.error("Error deleting chapter");
    }
  }

  // Poll if any generation is in progress
  useEffect(() => {
    if (!data) return;
    const hasGenerating = data.generations.some(
      (g) => g.status === "generating",
    );
    if (!hasGenerating) return;

    const interval = setInterval(() => {
      if (fetchingRef.current) return;
      fetchingRef.current = true;
      fetchChapter().finally(() => { fetchingRef.current = false; });
    }, 3000);
    return () => clearInterval(interval);
  }, [data]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="max-w-4xl mx-auto p-6 text-center py-20">
        <p className="text-destructive mb-4">{error ?? "Chapter not found"}</p>
        <Link href="/projects" className="text-sm text-primary hover:underline">
          Back to projects
        </Link>
      </div>
    );
  }

  const { chapter, generations, projectName } = data;

  const totalTokens = generations.reduce((sum, g) => {
    return sum + g.fragments.reduce((s, f) => s + (f.tokensUsed ?? 0), 0);
  }, 0);

  return (
    <div className="max-w-4xl mx-auto p-6">
      <Breadcrumbs
        items={[
          { label: "Projects", href: "/projects" },
          { label: projectName, href: `/projects/${params.id}` },
          { label: `Capítulo ${chapter.position + 1}: ${chapter.title}` },
        ]}
      />

      <div className="mt-6 mb-8">
        {editingTitle ? (
          <div className="flex items-center gap-2 mb-1">
            <Input
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              className="text-2xl font-bold h-auto py-1"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") saveChapterTitle();
                if (e.key === "Escape") setEditingTitle(false);
              }}
            />
            <Button size="icon" variant="ghost" onClick={saveChapterTitle}>
              <Check className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="ghost" onClick={() => setEditingTitle(false)}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-3 mb-1">
            <BookOpen className="h-5 w-5 text-muted-foreground" />
            <h1 className="text-2xl font-bold">{chapter.title}</h1>
            <Button
              size="icon"
              variant="ghost"
              onClick={() => {
                setEditTitle(chapter.title);
                setEditingTitle(true);
              }}
            >
              <Pencil className="h-4 w-4 text-muted-foreground" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="text-muted-foreground hover:text-destructive"
              onClick={deleteChapter}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        )}
        <p className="text-sm text-muted-foreground mt-1">
          {generations.length} generación{generations.length !== 1 ? "es" : ""} ·{" "}
          {totalTokens > 0 ? `${totalTokens.toLocaleString()} tokens` : "Sin generaciones"}
        </p>
      </div>

      {generations.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <AlertTriangle className="h-10 w-10 text-muted-foreground/40 mb-3" />
          <h2 className="text-lg font-medium mb-1">No generations yet</h2>
          <p className="text-sm text-muted-foreground max-w-sm">
            Regresa al proyecto y haz clic en Generar para crear este capítulo.
          </p>
          <Link
            href={`/projects/${params.id}`}
            className="mt-4 text-sm text-primary hover:underline"
          >
            Volver al proyecto
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {generations.map((gen) => (
            <Card key={gen.id}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <CardTitle className="text-sm font-medium">
                      Generación{" "}
                      <span className="text-muted-foreground font-mono text-xs">
                        {gen.id.slice(0, 8)}
                      </span>
                    </CardTitle>
                    {statusBadge(gen.status)}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    {formatDistanceToNow(new Date(gen.createdAt), {
                      addSuffix: true,
                      locale: es,
                    })}
                  </div>
                </div>
              </CardHeader>

              {gen.status === "failed" && gen.error && (
                <CardContent>
                  <p className="text-sm text-destructive bg-destructive/5 rounded-md p-3">
                    {gen.error}
                  </p>
                </CardContent>
              )}

              {gen.status === "generating" && (
                <CardContent>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Generando fragmentos...
                  </div>
                </CardContent>
              )}

              {gen.status === "completed" && gen.assembledContent && (
                <CardContent>
                  <div className="prose prose-sm dark:prose-invert max-w-none">
                    <ReactMarkdown rehypePlugins={[rehypeSanitize]}>{gen.assembledContent}</ReactMarkdown>
                  </div>

                  {/* Fragments toggle */}
                  {gen.fragments.length > 0 && (
                    <div className="mt-6 border-t pt-4">
                      <button
                        onClick={() =>
                          setExpandedGen(
                            expandedGen === gen.id ? null : gen.id,
                          )
                        }
                        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                      >
                        <ChevronRight
                          className={`h-3 w-3 transition-transform ${
                            expandedGen === gen.id ? "rotate-90" : ""
                          }`}
                        />
                        Fragmentos ({gen.fragments.length})
                      </button>

                      {expandedGen === gen.id && (
                        <div className="mt-3 space-y-2">
                          {gen.fragments.map((f) => (
                            <div
                              key={f.id}
                              className="border rounded-md p-3 text-sm"
                            >
                              <div className="flex items-center gap-2 mb-1">
                                <span className="font-medium text-xs">
                                  {FRAGMENT_LABELS[f.type ?? ""] ?? f.type}{" "}
                                  <span className="text-muted-foreground">
                                    (#{f.position})
                                  </span>
                                </span>
                                {f.modelUsed && (
                                  <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                                    {f.modelUsed}
                                  </span>
                                )}
                                {f.tokensUsed != null && (
                                  <span className="text-[10px] text-muted-foreground">
                                    {f.tokensUsed.toLocaleString()} tok
                                  </span>
                                )}
                              </div>
                              <div className="prose prose-sm dark:prose-invert max-w-none text-muted-foreground">
                                <ReactMarkdown rehypePlugins={[rehypeSanitize]}>{f.content ?? ""}</ReactMarkdown>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
