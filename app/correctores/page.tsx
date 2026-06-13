"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { PageHeader } from "@/components/patterns/page-header";
import { EmptyState } from "@/components/patterns/empty-state";
import { ResourceCard } from "@/components/patterns/resource-card";
import { LoadingSkeleton } from "@/components/patterns/loading-skeleton";
import { Loader2, Plus, Wrench } from "lucide-react";
import { toast } from "sonner";

interface CorrectorPrompt {
  id: string;
  name: string;
  description: string | null;
  content: string;
  userPrompt: string | null;
  createdAt: string;
}

export default function CorrectoresPage() {
  const router = useRouter();
  const [correctores, setCorrectores] = useState<CorrectorPrompt[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newContent, setNewContent] = useState("");
  const [newUserPrompt, setNewUserPrompt] = useState("");

  const fetchCorrectores = useCallback(async () => {
    const res = await fetch("/api/corrector-prompts");
    if (res.ok) setCorrectores(await res.json());
    setLoading(false);
  }, []);

  useEffect(() => { fetchCorrectores(); }, [fetchCorrectores]);

  async function create() {
    if (!newName.trim() || !newContent.trim()) return;
    setCreating(true);
    const res = await fetch("/api/corrector-prompts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName.trim(), description: newDescription.trim() || null, content: newContent, userPrompt: newUserPrompt.trim() || null }),
    });
    if (res.ok) {
      setCreateOpen(false);
      setNewName("");
      setNewDescription("");
      setNewContent("");
      setNewUserPrompt("");
      router.refresh();
      fetchCorrectores();
      toast.success("Corrector prompt created");
    } else {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error ?? "Error creating");
    }
    setCreating(false);
  }

  async function deleteCorrector(id: string) {
    if (!confirm("Delete this corrector prompt?")) return;
    const res = await fetch(`/api/corrector-prompts/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Failed to delete" }));
      toast.error(err.error ?? "Failed to delete");
      return;
    }
    fetchCorrectores();
    toast.success("Corrector prompt deleted");
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
        breadcrumbs={[{ label: "Corrector Prompts" }]}
        title="Corrector Prompts"
      >
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4" /> New Corrector Prompt</Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Create Corrector Prompt</DialogTitle>
              <DialogDescription>
                Corrector prompts apply critique findings to fix continuity and language issues in chapters.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input id="name" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Chapter Corrector" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="desc">Description (optional)</Label>
                <Input id="desc" value={newDescription} onChange={(e) => setNewDescription(e.target.value)} placeholder="How this corrector fixes chapter issues" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="content">System Prompt</Label>
                <Textarea id="content" value={newContent} onChange={(e) => setNewContent(e.target.value)} placeholder="Eres un editor corrector de no-ficción..." rows={10} className="font-mono text-xs" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="userPrompt">User Prompt</Label>
                <Textarea id="userPrompt" value={newUserPrompt} onChange={(e) => setNewUserPrompt(e.target.value)} placeholder="{{CONTENIDO_CAPITULO}}\n{{CONTENIDO_CRITICA}}\n\nCorrige el capítulo aplicando los hallazgos de la crítica." rows={6} className="font-mono text-xs" />
                <p className="text-[10px] text-muted-foreground">Use {"{{CONTENIDO_CAPITULO}}"} and {"{{CONTENIDO_CRITICA}}"} as placeholders. Leave empty to use System Prompt as user message.</p>
              </div>
              <Button onClick={create} disabled={creating || !newName.trim() || !newContent.trim()} className="w-full">
                {creating && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Create
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </PageHeader>

      {correctores.length === 0 ? (
        <EmptyState
          icon={Wrench}
          title="No corrector prompts yet"
          description="Create your first corrector prompt to fix issues found by critique analysis."
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {correctores.map((cp) => (
            <ResourceCard
              key={cp.id}
              href={`/correctores/${cp.id}`}
              title={cp.name}
              description={cp.description}
              onDelete={() => deleteCorrector(cp.id)}
            >
              {cp.userPrompt ? (
                <p className="text-xs text-muted-foreground mt-2 line-clamp-2">User: {cp.userPrompt.slice(0, 120)}</p>
              ) : (
                <p className="text-xs text-muted-foreground mt-2 line-clamp-2">{cp.content.slice(0, 120)}</p>
              )}
            </ResourceCard>
          ))}
        </div>
      )}
    </div>
  );
}
