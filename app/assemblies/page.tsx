"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Loader2, Plus, Trash2, Puzzle } from "lucide-react";
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
        <div className="animate-pulse space-y-4">
          {[1, 2, 3].map((i) => (<div key={i} className="h-24 bg-muted rounded-lg" />))}
        </div>
      </div>
    );
  }

  return (
    <div className="py-6">
      <Breadcrumbs items={[{ label: "Assembly Prompts" }]} />

      <div className="flex items-center justify-between mb-6 mt-4">
        <h1 className="text-2xl font-bold">Assembly Prompts</h1>
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
      </div>

      {assemblies.length === 0 ? (
        <div className="text-center py-16 space-y-4">
          <Puzzle className="h-12 w-12 mx-auto text-muted-foreground" />
          <p className="text-muted-foreground">No assembly prompts yet.</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {assemblies.map((ap) => (
            <Card key={ap.id} className="group relative hover:border-brand-200 dark:hover:border-brand-800 hover:shadow-sm transition-all duration-200">
              <Link href={`/assemblies/${ap.id}`}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base group-hover:text-primary transition-colors">{ap.name}</CardTitle>
                </CardHeader>
                <CardContent>
                  {ap.description ? (
                    <CardDescription className="line-clamp-2">{ap.description}</CardDescription>
                  ) : (
                    <CardDescription className="italic">No description</CardDescription>
                  )}
                  <p className="text-xs text-muted-foreground mt-2 font-mono line-clamp-2">{ap.content.slice(0, 120)}</p>
                </CardContent>
              </Link>
              <Button
                variant="ghost" size="icon"
                className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                onClick={(e) => { e.preventDefault(); deleteAssembly(ap.id); }}
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
