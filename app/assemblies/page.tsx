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
import { Loader2, Plus, Puzzle } from "lucide-react";
import { toast } from "sonner";

interface AssemblyPrompt {
  id: string;
  name: string;
  description: string | null;
  content: string;
  userPrompt: string | null;
  createdAt: string;
}

export default function AssembliesPage() {
  const router = useRouter();
  const [assemblies, setAssemblies] = useState<AssemblyPrompt[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newContent, setNewContent] = useState("");
  const [newUserPrompt, setNewUserPrompt] = useState("");

  const fetchAssemblies = useCallback(async () => {
    const res = await fetch("/api/assembly-prompts");
    if (res.ok) setAssemblies(await res.json());
    setLoading(false);
  }, []);

  useEffect(() => { fetchAssemblies(); }, [fetchAssemblies]);

  async function create() {
    if (!newName.trim() || !newContent.trim()) return;
    setCreating(true);
    const res = await fetch("/api/assembly-prompts", {
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
      fetchAssemblies();
      toast.success("Assembly prompt created");
    } else {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error ?? "Error creating");
    }
    setCreating(false);
  }

  async function deleteAssembly(id: string) {
    if (!confirm("Delete this assembly prompt?")) return;
    const res = await fetch(`/api/assembly-prompts/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Failed to delete" }));
      toast.error(err.error ?? "Failed to delete");
      return;
    }
    fetchAssemblies();
    toast.success("Assembly prompt deleted");
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
        breadcrumbs={[{ label: "Assembly Prompts" }]}
        title="Assembly Prompts"
      >
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4" /> New Assembly Prompt</Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Create Assembly Prompt</DialogTitle>
              <DialogDescription>
                Assembly prompts merge content fragments into a unified chapter.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input id="name" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Default Chapter Assembly" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="desc">Description (optional)</Label>
                <Input id="desc" value={newDescription} onChange={(e) => setNewDescription(e.target.value)} placeholder="When to use this assembly style" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="content">System Prompt</Label>
                <Textarea id="content" value={newContent} onChange={(e) => setNewContent(e.target.value)} placeholder="Eres un editor senior..." rows={10} className="font-mono text-xs" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="userPrompt">User Prompt</Label>
                <Textarea id="userPrompt" value={newUserPrompt} onChange={(e) => setNewUserPrompt(e.target.value)} placeholder="[PEGAR AQUÍ TODOS LOS FRAGMENTOS DEL CAPÍTULO]&#10;&#10;Ensambla los fragmentos en un capítulo unificado sobre {tema}." rows={6} className="font-mono text-xs" />
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

      {assemblies.length === 0 ? (
        <EmptyState
          icon={Puzzle}
          title="No assembly prompts yet"
          description="Create your first assembly prompt to merge content fragments into unified chapters."
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {assemblies.map((ap) => (
            <ResourceCard
              key={ap.id}
              href={`/assemblies/${ap.id}`}
              title={ap.name}
              description={ap.description}
              onDelete={() => deleteAssembly(ap.id)}
            >
              <p className="text-xs text-muted-foreground mt-2 line-clamp-2">{ap.content.slice(0, 120)}</p>
            </ResourceCard>
          ))}
        </div>
      )}
    </div>
  );
}
