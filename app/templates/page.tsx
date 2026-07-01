"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { PageHeader } from "@/components/patterns/page-header";
import { EmptyState } from "@/components/patterns/empty-state";
import { ResourceCard } from "@/components/patterns/resource-card";
import { LoadingSkeleton } from "@/components/patterns/loading-skeleton";
import { Plus, BookOpen } from "lucide-react";

interface Template {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  chapterCount: number;
}

export default function TemplatesPage() {
  const router = useRouter();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const fetchTemplates = useCallback(async () => {
    const res = await fetch("/api/books");
    if (res.ok) setTemplates(await res.json());
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  async function deleteTemplate(id: string) {
    setDeleteTarget(id);
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    const id = deleteTarget;
    setDeleteTarget(null);
    const res = await fetch(`/api/books/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Failed to delete" }));
      alert(err.error ?? "Failed to delete");
      return;
    }
    fetchTemplates();
  }

  if (loading) {
    return (
      <div className="py-6">
        <LoadingSkeleton count={3} />
      </div>
    );
  }

  return (
    <div className="py-6">
      <PageHeader
        breadcrumbs={[{ label: "Book Templates" }]}
        title="Book Templates"
      >
        <Button onClick={() => router.push("/templates/create")}>
          <Plus className="h-4 w-4" />
          New Template
        </Button>
      </PageHeader>

      {templates.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title="No templates yet"
          description="Create your first book template to start building book structures."
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {templates.map((t) => (
            <ResourceCard
              key={t.id}
              href={`/templates/${t.id}`}
              title={t.name}
              description={t.description}
              onDelete={() => deleteTemplate(t.id)}
            >
              <p className="text-xs text-muted-foreground mt-2">
                {t.chapterCount}{" "}
                {t.chapterCount === 1 ? "chapter" : "chapters"}
              </p>
            </ResourceCard>
          ))}
        </div>
      )}
      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        description="Delete this template and all its chapters/prompts?"
        onConfirm={confirmDelete}
      />
    </div>
  );
}
