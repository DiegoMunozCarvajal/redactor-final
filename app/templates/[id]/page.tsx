"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { ChapterEditor } from "@/components/prompts/chapter-editor";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Loader2, Pencil, Check, X, Trash2, GripVertical } from "lucide-react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { toast } from "sonner";
import type { Chapter, Prompt } from "@/lib/db/schema";

interface ChapterWithPrompts extends Chapter {
  prompts: Prompt[];
}

interface TemplateData {
  id: string;
  name: string;
  description: string | null;
  chapters: ChapterWithPrompts[];
}

function SortableChapterRow({
  chapter,
  templateId,
  onDelete,
}: {
  chapter: ChapterWithPrompts;
  templateId: string;
  onDelete: (id: string) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: chapter.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="flex items-start gap-2">
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground transition-colors mt-4 p-1 rounded shrink-0"
        aria-label="Drag to reorder"
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <div className="flex-1">
        <ChapterEditor bookId={templateId} chapter={chapter} />
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="shrink-0 text-muted-foreground hover:text-destructive mt-2"
        onClick={() => onDelete(chapter.id)}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
}

export default function AdminBookPage() {
  const params = useParams<{ id: string }>();
  const [template, setTemplate] = useState<TemplateData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [editingDesc, setEditingDesc] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [addingChapter, setAddingChapter] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id || !template) return;

    const oldIndex = template.chapters.findIndex((ch) => ch.id === active.id);
    const newIndex = template.chapters.findIndex((ch) => ch.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(template.chapters, oldIndex, newIndex).map(
      (ch, i) => ({ ...ch, position: i }),
    );
    setTemplate({ ...template, chapters: reordered });

    const res = await fetch(`/api/books/${template.id}/chapters/reorder`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chapters: reordered.map((ch) => ({ id: ch.id, position: ch.position })),
      }),
    });

    if (!res.ok) {
      fetchTemplate();
      toast.error("Error reordering chapters");
    }
  }

  const fetchTemplate = useCallback(async () => {
    try {
      const res = await fetch(`/api/books/${params.id}/chapters`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const chapterList: Chapter[] = await res.json();

      const chaptersWithPrompts = await Promise.all(
        chapterList.map(async (ch) => {
          const pres = await fetch(`/api/chapters/${ch.id}/prompts`);
          const prompts = pres.ok ? await pres.json() : [];
          return { ...ch, prompts };
        })
      );

      const tres = await fetch(`/api/books/${params.id}`);
      if (!tres.ok) throw new Error(`HTTP ${tres.status}`);
      const t = await tres.json();

      setTemplate({ ...t, chapters: chaptersWithPrompts });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    fetchTemplate();
  }, [fetchTemplate]);

  async function saveName() {
    if (!template) return;
    await fetch(`/api/books/${template.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editName }),
    });
    setTemplate({ ...template, name: editName });
    setEditingName(false);
  }

  async function saveDescription() {
    if (!template) return;
    await fetch(`/api/books/${template.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: editDesc }),
    });
    setTemplate({ ...template, description: editDesc });
    setEditingDesc(false);
  }

  async function addChapter() {
    if (!template) return;
    setAddingChapter(true);
    const maxPos = template.chapters.reduce((max, ch) => Math.max(max, ch.position), 0);
    const res = await fetch(`/api/books/${template.id}/chapters`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: `Capítulo ${maxPos + 1}`,
        position: maxPos + 1,
      }),
    });
    if (res.ok) {
      const ch = await res.json();
      setTemplate({
        ...template,
        chapters: [...template.chapters, { ...ch, prompts: [] }],
      });
    }
    setAddingChapter(false);
  }

  async function deleteChapter(chapterId: string) {
    if (!template) return;
    await fetch(`/api/chapters/${chapterId}`, { method: "DELETE" });
    setTemplate({
      ...template,
      chapters: template.chapters.filter((ch) => ch.id !== chapterId),
    });
  }

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto p-6 animate-pulse space-y-4">
        <div className="h-8 bg-muted rounded w-1/3" />
        <div className="h-4 bg-muted rounded w-1/2" />
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-16 bg-muted rounded" />
        ))}
      </div>
    );
  }

  if (error || !template) {
    return (
      <div className="max-w-3xl mx-auto p-6 text-center py-20">
        <p className="text-destructive mb-4">{error ?? "Template not found"}</p>
      </div>
    );
  }

  const chapterCount = template.chapters.length;

  return (
    <div className="max-w-3xl mx-auto">
      <Breadcrumbs
        items={[
          { label: "Templates", href: "/templates" },
          { label: template.name },
        ]}
      />

      {/* Template name */}
      <div className="flex items-start justify-between mb-3 mt-4">
        {editingName ? (
          <div className="flex items-center gap-2">
            <Input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="text-2xl font-bold h-auto py-1"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") saveName();
                if (e.key === "Escape") setEditingName(false);
              }}
            />
            <Button size="icon" variant="ghost" onClick={saveName}>
              <Check className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="ghost" onClick={() => setEditingName(false)}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <h1
            className="text-2xl font-bold mb-2 cursor-pointer hover:text-primary/80 transition-colors"
            onClick={() => {
              setEditName(template.name);
              setEditingName(true);
            }}
            title="Click to edit"
          >
            {template.name}
          </h1>
        )}
      </div>

      {/* Template description */}
      <div className="mb-4">
        {editingDesc ? (
          <div className="flex items-start gap-2">
            <Textarea
              value={editDesc}
              onChange={(e) => setEditDesc(e.target.value)}
              className="text-muted-foreground leading-relaxed max-w-prose"
              rows={3}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Escape") setEditingDesc(false);
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") saveDescription();
              }}
            />
            <div className="flex flex-col gap-1">
              <Button size="icon" variant="ghost" onClick={saveDescription}>
                <Check className="h-4 w-4" />
              </Button>
              <Button size="icon" variant="ghost" onClick={() => setEditingDesc(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-2">
            {template.description ? (
              <p className="text-base text-muted-foreground leading-relaxed max-w-prose">
                {template.description}
              </p>
            ) : (
              <p className="text-base text-muted-foreground italic">No description</p>
            )}
            <Button
              size="icon"
              variant="ghost"
              className="shrink-0"
              onClick={() => {
                setEditDesc(template.description ?? "");
                setEditingDesc(true);
              }}
            >
              <Pencil className="h-3 w-3 text-muted-foreground" />
            </Button>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between mb-6">
        <p className="text-sm text-muted-foreground">
          {chapterCount} {chapterCount === 1 ? "capítulo" : "capítulos"}
        </p>
        <Button variant="outline" size="sm" onClick={addChapter} disabled={addingChapter}>
          {addingChapter ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Plus className="h-4 w-4" />
          )}
          Add Chapter
        </Button>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={template.chapters.map((ch) => ch.id)}
          strategy={verticalListSortingStrategy}
        >
          <div className="space-y-3">
            {template.chapters.map((ch) => (
              <SortableChapterRow
                key={ch.id}
                chapter={ch}
                templateId={template.id}
                onDelete={deleteChapter}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}

function arrayMove<T>(array: T[], from: number, to: number): T[] {
  const result = [...array];
  const [removed] = result.splice(from, 1);
  result.splice(to, 0, removed);
  return result;
}
