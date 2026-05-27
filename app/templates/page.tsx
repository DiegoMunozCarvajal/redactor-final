"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { PageHeader } from "@/components/patterns/page-header";
import { EmptyState } from "@/components/patterns/empty-state";
import { ResourceCard } from "@/components/patterns/resource-card";
import { LoadingSkeleton } from "@/components/patterns/loading-skeleton";
import { Loader2, Plus, Wand2, BookOpen } from "lucide-react";

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
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");

  const fetchTemplates = useCallback(async () => {
    const res = await fetch("/api/books");
    if (res.ok) setTemplates(await res.json());
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  async function createTemplate() {
    if (!newName.trim()) return;
    setCreating(true);
    const res = await fetch("/api/books", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName.trim(), description: newDescription.trim() || null }),
    });
    if (res.ok) {
      setCreateOpen(false);
      setNewName("");
      setNewDescription("");
      router.refresh();
      fetchTemplates();
    }
    setCreating(false);
  }

  async function deleteTemplate(id: string) {
    if (!confirm("Delete this template and all its chapters/prompts?")) return;
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
        <Button variant="outline" onClick={() => router.push("/templates/create")}>
          <Wand2 className="h-4 w-4" />
          Generate from Meta-Prompt
        </Button>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4" />
              New Template
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Create Template</DialogTitle>
              <DialogDescription>
                Create a new book template. You can add chapters and prompts after creation.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Template name"
                  onKeyDown={(e) => e.key === "Enter" && createTemplate()}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="desc">Description</Label>
                <Textarea
                  id="desc"
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  placeholder="Optional description"
                  rows={3}
                />
              </div>
              <Button onClick={createTemplate} disabled={creating || !newName.trim()} className="w-full">
                {creating && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Create
              </Button>
            </div>
          </DialogContent>
        </Dialog>
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
    </div>
  );
}
