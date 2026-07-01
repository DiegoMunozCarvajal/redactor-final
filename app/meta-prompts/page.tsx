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
import { Loader2, Plus, Wand2 } from "lucide-react";
import { toast } from "sonner";

interface MetaPrompt {
  id: string;
  name: string;
  description: string | null;
  content: string;
  userPrompt: string | null;
  createdAt: string;
}

export default function MetaPromptsPage() {
  const router = useRouter();
  const [metaPrompts, setMetaPrompts] = useState<MetaPrompt[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newContent, setNewContent] = useState("");
  const [newUserPrompt, setNewUserPrompt] = useState("");

  const fetchMetaPrompts = useCallback(async () => {
    const res = await fetch("/api/meta-prompts");
    if (res.ok) setMetaPrompts(await res.json());
    setLoading(false);
  }, []);

  useEffect(() => { fetchMetaPrompts(); }, [fetchMetaPrompts]);

  async function create() {
    if (!newName.trim() || !newContent.trim()) return;
    setCreating(true);
    const res = await fetch("/api/meta-prompts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName.trim(), description: newDescription.trim() || null, content: newContent, userPrompt: newUserPrompt || null }),
    });
    if (res.ok) {
      setCreateOpen(false);
      setNewName("");
      setNewDescription("");
      setNewContent("");
      setNewUserPrompt("");
      router.refresh();
      fetchMetaPrompts();
      toast.success("Meta-prompt created");
    } else {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error ?? "Error creating");
    }
    setCreating(false);
  }

  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  function deleteMetaPrompt(id: string) {
    setDeleteTarget(id);
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    const id = deleteTarget;
    setDeleteTarget(null);
    const res = await fetch(`/api/meta-prompts/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Failed to delete" }));
      toast.error(err.error ?? "Failed to delete");
      return;
    }
    fetchMetaPrompts();
    toast.success("Meta-prompt deleted");
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
        breadcrumbs={[{ label: "Meta-Prompts" }]}
        title="Meta-Prompts"
      >
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4" /> New Meta-Prompt</Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Create Meta-Prompt</DialogTitle>
              <DialogDescription>
                Meta-prompts analyze source chapters and generate content-creating prompts.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input id="name" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Atomic Habits Extractor" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="desc">Description (optional)</Label>
                <Input id="desc" value={newDescription} onChange={(e) => setNewDescription(e.target.value)} placeholder="What kind of chapters this extracts patterns from" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="content">System Prompt</Label>
                <Textarea id="content" value={newContent} onChange={(e) => setNewContent(e.target.value)} placeholder="Actúa como un arquitecto narrativo..." rows={10} className="font-mono text-xs" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="userPrompt">User Prompt</Label>
                <Textarea id="userPrompt" value={newUserPrompt} onChange={(e) => setNewUserPrompt(e.target.value)} placeholder="Analiza el siguiente capítulo fuente y extrae su arquitectura funcional.\n\n<capitulo_fuente>\n{{CAPITULO_FUENTE}}\n</capitulo_fuente>\n\nResponde ÚNICAMENTE con la lista de los bloques en formato JSON." rows={6} className="font-mono text-xs" />
                <p className="text-xs text-muted-foreground">Template para user message. Usa {'{{'} CAPITULO_FUENTE {'}}'} como placeholder.</p>
              </div>
              <Button onClick={create} disabled={creating || !newName.trim() || !newContent.trim()} className="w-full">
                {creating && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Create
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </PageHeader>

      {metaPrompts.length === 0 ? (
        <EmptyState
          icon={Wand2}
          title="No meta-prompts yet"
          description="Create your first meta-prompt to generate content-creating prompts from source chapters."
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {metaPrompts.map((mp) => (
            <ResourceCard
              key={mp.id}
              href={`/meta-prompts/${mp.id}`}
              title={mp.name}
              description={mp.description}
              onDelete={() => deleteMetaPrompt(mp.id)}
            >
              {mp.userPrompt ? (
                <p className="text-xs text-muted-foreground mt-2 line-clamp-2">User: {mp.userPrompt.slice(0, 120)}</p>
              ) : (
                <p className="text-xs text-muted-foreground mt-2 line-clamp-2">{mp.content.slice(0, 120)}</p>
              )}
            </ResourceCard>
          ))}
        </div>
      )}
      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        description="Delete this meta-prompt? This cannot be undone."
        onConfirm={confirmDelete}
      />
    </div>
  );
}
