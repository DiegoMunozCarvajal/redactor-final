"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type Modifier,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";

const restrictToVerticalAxis: Modifier = ({ transform }) => ({
  ...transform,
  x: 0,
});
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { GripVertical, Trash2 } from "lucide-react";
import { toast } from "sonner";

interface GenerationData {
  id: string;
  status: string;
  assembledContent: string | null;
  error: string | null;
  createdAt: string;
}

interface ChapterData {
  id: string;
  position: number;
  title: string;
  latestGeneration: GenerationData | null;
}

function statusBadge(status: string) {
  switch (status) {
    case "completed":
      return (
        <Badge className="bg-success/10 text-success border-success/20">
          Completado
        </Badge>
      );
    case "generating":
      return (
        <Badge className="bg-info/10 text-info border-info/20">
          Generando
        </Badge>
      );
    case "failed":
      return <Badge variant="destructive">Fallido</Badge>;
    default:
      return <Badge variant="secondary">{status}</Badge>;
  }
}

function SortableChapter({
  chapter,
  projectId,
  onDelete,
}: {
  chapter: ChapterData;
  projectId: string;
  onDelete: (id: string) => void;
}) {
  const router = useRouter();
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
    <Card
      ref={setNodeRef}
      style={style}
      className="cursor-pointer hover:border-primary/50 transition-colors"
      onClick={() =>
        router.push(`/projects/${projectId}/chapters/${chapter.id}`)
      }
    >
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              {...attributes}
              {...listeners}
              className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground transition-colors -ml-1 p-1 rounded"
              onClick={(e) => e.stopPropagation()}
              aria-label="Drag to reorder"
            >
              <GripVertical className="h-4 w-4" />
            </button>
            <CardTitle className="text-base">{chapter.title}</CardTitle>
            {chapter.latestGeneration &&
              statusBadge(chapter.latestGeneration.status)}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="text-muted-foreground hover:text-destructive"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(chapter.id);
              }}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
    </Card>
  );
}

export function SortableChapterList({
  chapters: initialChapters,
  projectId,
  onDelete,
}: {
  chapters: ChapterData[];
  projectId: string;
  onDelete: (id: string) => void;
}) {
  const [chapters, setChapters] = useState(initialChapters);

  // Sync when parent re-fetches (new chapter added, polling, etc.)
  useEffect(() => {
    setChapters(initialChapters);
  }, [initialChapters]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = chapters.findIndex((ch) => ch.id === active.id);
    const newIndex = chapters.findIndex((ch) => ch.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(chapters, oldIndex, newIndex).map(
      (ch, i) => ({ ...ch, position: i }),
    );
    setChapters(reordered);

    // Persist to server
    const res = await fetch(`/api/projects/${projectId}/chapters/reorder`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chapters: reordered.map((ch) => ({ id: ch.id, position: ch.position })),
      }),
    });

    if (!res.ok) {
      // Revert on failure
      setChapters(initialChapters);
      toast.error("Error reordering chapters");
    }
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis]}
      onDragEnd={handleDragEnd}
    >
      <SortableContext
        items={chapters.map((ch) => ch.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className="space-y-4">
          {chapters.map((ch) => (
            <SortableChapter
              key={ch.id}
              chapter={ch}
              projectId={projectId}
              onDelete={onDelete}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

function arrayMove<T>(array: T[], from: number, to: number): T[] {
  const result = [...array];
  const [removed] = result.splice(from, 1);
  result.splice(to, 0, removed);
  return result;
}
