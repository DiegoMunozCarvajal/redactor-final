"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { BookOpen, Loader2, Plus, Trash2, Wand2 } from "lucide-react";

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
        <div className="animate-pulse space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 bg-muted rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="py-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Book Templates</h1>
        <div className="flex items-center gap-2">
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
        </div>
      </div>

      {templates.length === 0 ? (
        <div className="text-center py-16 space-y-4">
          <BookOpen className="h-12 w-12 mx-auto text-muted-foreground" />
          <p className="text-muted-foreground">
            No templates yet. Create your first book template.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {templates.map((t) => (
            <Card key={t.id} className="group relative hover:border-brand-200 dark:hover:border-brand-800 hover:shadow-sm transition-all duration-200">
              <Link href={`/templates/${t.id}`}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base group-hover:text-primary transition-colors">{t.name}</CardTitle>
                </CardHeader>
                <CardContent>
                  {t.description ? (
                    <CardDescription className="line-clamp-3">
                      {t.description}
                    </CardDescription>
                  ) : (
                    <CardDescription className="italic">
                      No description
                    </CardDescription>
                  )}
                  <p className="text-xs text-muted-foreground mt-2">
                    {t.chapterCount}{" "}
                    {t.chapterCount === 1 ? "chapter" : "chapters"}
                  </p>
                </CardContent>
              </Link>
              <Button
                variant="ghost"
                size="icon"
                className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                onClick={(e) => {
                  e.preventDefault();
                  deleteTemplate(t.id);
                }}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
