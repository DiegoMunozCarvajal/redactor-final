"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { PageHeader } from "@/components/patterns/page-header";
import { EmptyState } from "@/components/patterns/empty-state";
import { ResourceCard } from "@/components/patterns/resource-card";
import { LoadingSkeleton } from "@/components/patterns/loading-skeleton";
import { Loader2, Plus, Sparkles } from "lucide-react";
import { toast } from "sonner";

interface GenerationPrompt {
  id: string;
  name: string;
  description: string | null;
  content: string;
  isDefault: boolean;
  createdAt: string;
}

export default function GenerationPage() {
  const router = useRouter();
  const [prompts, setPrompts] = useState<GenerationPrompt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newContent, setNewContent] = useState("");
  const [newDefault, setNewDefault] = useState(false);

  const fetchPrompts = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch("/api/generation-prompts", { signal });
      if (res.ok) {
        setPrompts(await res.json());
        setError(null);
      } else {
        setError("Failed to load generation prompts");
        toast.error("Failed to load generation prompts");
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError("Could not connect to server");
      toast.error("Could not connect to server");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetchPrompts(controller.signal);
    return () => controller.abort();
  }, [fetchPrompts]);

  async function create() {
    if (!newName.trim() || !newContent.trim()) return;
    setCreating(true);
    const res = await fetch("/api/generation-prompts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: newName.trim(),
        content: newContent,
        is_default: newDefault,
      }),
    });
    if (res.ok) {
      setCreateOpen(false);
      setNewName("");
      setNewContent("");
      setNewDefault(false);
      router.refresh();
      fetchPrompts();
      toast.success("Generation prompt created");
    } else {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error ?? "Error creating");
    }
    setCreating(false);
  }

  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  function deletePrompt(id: string) {
    setDeleteTarget(id);
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    const id = deleteTarget;
    setDeleteTarget(null);
    const res = await fetch(`/api/generation-prompts/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Failed to delete" }));
      toast.error(err.error ?? "Failed to delete");
      return;
    }
    fetchPrompts();
    toast.success("Generation prompt deleted");
  }

  if (loading) return <LoadingSkeleton />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Generation Prompts"
        subtitle="System prompts for fragment generation. The default prompt is used unless a project overrides it."
      >
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4 mr-2" />New</Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Create Generation Prompt</DialogTitle>
              <DialogDescription>
                Add a new system prompt version for fragment generation.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label htmlFor="name">Name</Label>
                <Input id="name" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="System prompt v2" />
              </div>
              <div>
                <Label htmlFor="content">Content</Label>
                <Textarea id="content" value={newContent} onChange={(e) => setNewContent(e.target.value)} className="font-mono text-xs min-h-[300px]" placeholder="<rol>Eres un escritor..." />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={newDefault} onChange={(e) => setNewDefault(e.target.checked)} />
                Set as default
              </label>
              <Button onClick={create} disabled={creating || !newName.trim() || !newContent.trim()}>
                {creating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Create
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </PageHeader>

      {error && prompts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center gap-4">
          <p className="text-destructive font-medium">{error}</p>
          <Button variant="outline" onClick={() => fetchPrompts()}>Retry</Button>
        </div>
      ) : prompts.length === 0 ? (
        <EmptyState icon={Sparkles} title="No generation prompts" description="Create your first system prompt for fragment generation." />
      ) : (
        <div className="space-y-3">
          {error && (
            <div className="flex items-center justify-between px-4 py-2 bg-destructive/10 border border-destructive/20 rounded text-sm text-destructive">
              <span>{error} — showing cached data</span>
              <Button variant="outline" size="sm" onClick={() => fetchPrompts()}>Retry</Button>
            </div>
          )}
          {prompts.map((p) => (
            <ResourceCard
              key={p.id}
              href={`/generation/${p.id}`}
              title={p.name}
              description={p.description ?? `${p.content.length} chars`}
              onDelete={() => deletePrompt(p.id)}
            >
              {p.isDefault && (
                <span className="inline-block mt-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-brand-100 text-brand-700 dark:bg-brand-900 dark:text-brand-300">
                  default
                </span>
              )}
            </ResourceCard>
          ))}
        </div>
      )}
      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        description="Delete this generation prompt? This cannot be undone."
        onConfirm={confirmDelete}
      />
    </div>
  );
}
