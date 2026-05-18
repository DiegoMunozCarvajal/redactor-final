"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface Template {
  id: string;
  name: string;
}

interface TemplateChapter {
  id: string;
  title: string;
  position: number;
}

export function AddChapterDialog({
  projectId,
  onChapterAdded,
}: {
  projectId: string;
  onChapterAdded: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [templateChapters, setTemplateChapters] = useState<TemplateChapter[]>([]);
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const fetchTemplates = useCallback(async () => {
    const res = await fetch("/api/books");
    if (res.ok) setTemplates(await res.json());
  }, []);

  const fetchChapters = useCallback(async (templateId: string) => {
    setLoading(true);
    const res = await fetch(`/api/books/${templateId}/chapters`);
    if (res.ok) {
      const chapters: TemplateChapter[] = await res.json();
      setTemplateChapters(chapters);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  function resetForm() {
    setTitle("");
    setSelectedTemplateId(null);
    setSelectedChapterId(null);
    setTemplateChapters([]);
  }

  async function handleSubmit() {
    if (!title.trim()) return;
    setSubmitting(true);

    try {
      const body: { title: string; templateChapterId?: string } = { title: title.trim() };
      if (selectedChapterId) {
        body.templateChapterId = selectedChapterId;
      }

      const res = await fetch(`/api/projects/${projectId}/chapters`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        onChapterAdded();
        setOpen(false);
        resetForm();
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? "Error creating chapter");
      }
    } catch {
      toast.error("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm(); }}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Plus className="h-4 w-4" />
          Añadir capítulo
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Añadir capítulo</DialogTitle>
          <DialogDescription>
            Crea un nuevo capítulo. Opcionalmente, selecciona un template para copiar sus prompts.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="chapter-title">Título del capítulo</Label>
            <Input
              id="chapter-title"
              placeholder="Introducción"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSubmit();
              }}
            />
          </div>

          <div className="space-y-2">
            <Label>Template (opcional)</Label>
            <Select
              value={selectedTemplateId ?? "__none__"}
              onValueChange={(v) => {
                if (v === "__none__") {
                  setSelectedTemplateId(null);
                  setSelectedChapterId(null);
                  setTemplateChapters([]);
                } else {
                  setSelectedTemplateId(v);
                  setSelectedChapterId(null);
                  fetchChapters(v);
                }
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Sin template (empezar desde cero)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Sin template (empezar desde cero)</SelectItem>
                {templates.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectedTemplateId && (
            <div className="space-y-2">
              <Label>Capítulo del template</Label>
              <Select
                value={selectedChapterId ?? ""}
                onValueChange={(v) => setSelectedChapterId(v || null)}
                disabled={loading || templateChapters.length === 0}
              >
                <SelectTrigger>
                  <SelectValue placeholder={
                    loading
                      ? "Cargando capítulos..."
                      : templateChapters.length === 0
                        ? "No chapters in this template"
                        : "Selecciona un capítulo"
                  } />
                </SelectTrigger>
                <SelectContent>
                  {templateChapters.map((ch) => (
                    <SelectItem key={ch.id} value={ch.id}>
                      {ch.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <Button
            className="w-full"
            onClick={handleSubmit}
            disabled={!title.trim() || submitting}
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Crear capítulo
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
