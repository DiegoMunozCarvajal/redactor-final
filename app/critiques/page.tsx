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
import { Loader2, Plus, MessageSquareQuote } from "lucide-react";
import { toast } from "sonner";

interface CritiquePrompt {
  id: string;
  name: string;
  description: string | null;
  content: string;
  userPrompt: string | null;
  createdAt: string;
}

export default function CritiquesPage() {
  const router = useRouter();
  const [critiques, setCritiques] = useState<CritiquePrompt[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newContent, setNewContent] = useState("");
  const [newUserPrompt, setNewUserPrompt] = useState("");

  const fetchCritiques = useCallback(async () => {
    const res = await fetch("/api/critique-prompts");
    if (res.ok) setCritiques(await res.json());
    setLoading(false);
  }, []);

  useEffect(() => { fetchCritiques(); }, [fetchCritiques]);

  async function create() {
    if (!newName.trim() || !newContent.trim()) return;
    setCreating(true);
    const res = await fetch("/api/critique-prompts", {
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
      fetchCritiques();
      toast.success("Critique prompt created");
    } else {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error ?? "Error creating");
    }
    setCreating(false);
  }

  async function deleteCritique(id: string) {
    if (!confirm("Delete this critique prompt?")) return;
    const res = await fetch(`/api/critique-prompts/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Failed to delete" }));
      toast.error(err.error ?? "Failed to delete");
      return;
    }
    fetchCritiques();
    toast.success("Critique prompt deleted");
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
        breadcrumbs={[{ label: "Critique Prompts" }]}
        title="Critique Prompts"
      >
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4" /> New Critique Prompt</Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Create Critique Prompt</DialogTitle>
              <DialogDescription>
                Critique prompts analyze assembled chapter content and provide structured feedback.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input id="name" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Chapter Quality Review" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="desc">Description (optional)</Label>
                <Input id="desc" value={newDescription} onChange={(e) => setNewDescription(e.target.value)} placeholder="What aspect of the chapter this critique evaluates" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="content">System Prompt</Label>
                <Textarea id="content" value={newContent} onChange={(e) => setNewContent(e.target.value)} placeholder="Eres un editor crítico especializado..." rows={10} className="font-mono text-xs" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="userPrompt">User Prompt</Label>
                <Textarea id="userPrompt" value={newUserPrompt} onChange={(e) => setNewUserPrompt(e.target.value)} placeholder="[PEGAR AQUÍ EL CAPÍTULO A CRITICAR]\n\nAnaliza el capítulo y proporciona una crítica estructurada sobre {tema}." rows={6} className="font-mono text-xs" />
                <p className="text-[10px] text-muted-foreground">Leave empty to use System Prompt as user message with default system prompt.</p>
              </div>
              <Button onClick={create} disabled={creating || !newName.trim() || !newContent.trim()} className="w-full">
                {creating && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Create
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </PageHeader>

      {critiques.length === 0 ? (
        <EmptyState
          icon={MessageSquareQuote}
          title="No critique prompts yet"
          description="Create your first critique prompt to provide structured feedback on assembled chapters."
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {critiques.map((cp) => (
            <ResourceCard
              key={cp.id}
              href={`/critiques/${cp.id}`}
              title={cp.name}
              description={cp.description}
              onDelete={() => deleteCritique(cp.id)}
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
