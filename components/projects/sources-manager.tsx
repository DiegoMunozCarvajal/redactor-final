"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Loader2, Trash2, Upload, FileText } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface SourceData {
  id: string;
  fileName: string;
  fileType: string;
  sourceKind: "reference" | "example" | "mixed" | "unknown";
  citation: string | null;
  processed: boolean;
  chunkCount: number;
  createdAt: string;
}

function kindBadge(sourceKind: string) {
  switch (sourceKind) {
    case "reference":
      return (
        <Badge variant="outline" className="text-blue-600 border-blue-300 bg-blue-50">
          Bibliografía
        </Badge>
      );
    case "example":
      return (
        <Badge variant="outline" className="text-green-600 border-green-300 bg-green-50">
          Ejemplo
        </Badge>
      );
    case "mixed":
      return (
        <Badge variant="outline" className="text-amber-600 border-amber-300 bg-amber-50">
          Mixto
        </Badge>
      );
    default:
      return (
        <Badge variant="outline" className="text-gray-600 border-gray-300 bg-gray-50">
          General
        </Badge>
      );
  }
}

interface SourcesManagerProps {
  projectId: string;
}

export function SourcesManager({ projectId }: SourcesManagerProps) {
  const [sources, setSources] = useState<SourceData[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [sourceKind, setSourceKind] = useState<"reference" | "example">("reference");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchSources = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/sources`);
      if (!res.ok) throw new Error(`Failed to load (${res.status})`);
      const data = await res.json();
      setSources(data);
    } catch (err) {
      toast.error("Error loading sources");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchSources();
  }, [fetchSources]);

  async function handleUpload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    const fileInput = fileInputRef.current;
    if (!fileInput?.files?.length) {
      toast.error("Select a file first");
      return;
    }

    const file = fileInput.files[0];
    if (!file) return;

    const ext = file.name.split(".").pop()?.toLowerCase();
    if (ext !== "md" && ext !== "txt") {
      toast.error("Only .md and .txt files are supported");
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.set("file", file);
      formData.set("sourceKind", sourceKind);

      const res = await fetch(`/api/projects/${projectId}/sources`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Upload failed (${res.status})`);
      }

      const created = await res.json();
      toast.success(`"${created.fileName}" uploaded (${created.chunkCount} chunks)`);

      // Reset form
      if (fileInputRef.current) fileInputRef.current.value = "";
      setSourceKind("reference");

      // Refresh list
      await fetchSources();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(sourceId: string, fileName: string) {
    setDeletingId(sourceId);
    try {
      const res = await fetch(`/api/projects/${projectId}/sources/${sourceId}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Delete failed (${res.status})`);
      }

      setSources((prev) => prev.filter((s) => s.id !== sourceId));
      toast.success(`"${fileName}" deleted`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeletingId(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Upload form */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Upload className="h-4 w-4" />
            Upload source
          </CardTitle>
          <CardDescription>
            Upload .md or .txt files to enrich the RAG system with external
            knowledge.
          </CardDescription>
        </CardHeader>
        <div className="px-6 pb-6">
          <form onSubmit={handleUpload} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">File</label>
              <input
                ref={fileInputRef}
                type="file"
                accept=".md,.txt"
                className="block w-full text-sm text-muted-foreground
                  file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0
                  file:text-sm file:font-medium file:bg-primary file:text-primary-foreground
                  hover:file:bg-primary/90 file:cursor-pointer"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Type</label>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="sourceKind"
                    value="reference"
                    checked={sourceKind === "reference"}
                    onChange={() => setSourceKind("reference")}
                    className="text-primary"
                  />
                  <span className="text-sm">Bibliografía (paper, estudio)</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="sourceKind"
                    value="example"
                    checked={sourceKind === "example"}
                    onChange={() => setSourceKind("example")}
                    className="text-primary"
                  />
                  <span className="text-sm">Ejemplos (historia real)</span>
                </label>
              </div>
            </div>

            <Button type="submit" disabled={uploading}>
              {uploading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Uploading...
                </>
              ) : (
                "Upload"
              )}
            </Button>
          </form>
        </div>
      </Card>

      {/* Sources list */}
      {sources.length === 0 ? (
        <div className="text-center py-12 border rounded-lg bg-muted/30">
          <p className="text-muted-foreground">
            No hay fuentes. Sube documentos para enriquecer el RAG.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {sources.map((source) => (
            <Card key={source.id} className="relative">
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-3 min-w-0">
                    <FileText className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <CardTitle className="text-base truncate">
                        {source.fileName}
                      </CardTitle>
                      <div className="flex items-center gap-2 mt-1">
                        {kindBadge(source.sourceKind)}
                        <span className="text-xs text-muted-foreground">
                          {source.chunkCount} chunks
                        </span>
                      </div>
                      {source.citation && (
                        <p className="text-xs text-muted-foreground mt-2 truncate max-w-[300px]">
                          {source.citation}
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground mt-1">
                        {new Date(source.createdAt).toLocaleDateString("es-CL", {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                        })}
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 shrink-0"
                    onClick={() => handleDelete(source.id, source.fileName)}
                    disabled={deletingId === source.id}
                  >
                    {deletingId === source.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </CardHeader>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
