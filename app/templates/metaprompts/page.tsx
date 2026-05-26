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
import { Loader2, Plus, Trash2, Wand2 } from "lucide-react";
import { toast } from "sonner";

interface MetaPrompt {
  id: string;
  name: string;
  description: string | null;
  content: string;
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
      body: JSON.stringify({ name: newName.trim(), description: newDescription.trim() || null, content: newContent }),
    });
    if (res.ok) {
      setCreateOpen(false);
      setNewName("");
      setNewDescription("");
      setNewContent("");
      router.refresh();
      fetchMetaPrompts();
      toast.success("Meta-prompt created");
    } else {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error ?? "Error creating");
    }
    setCreating(false);
  }

  async function deleteMetaPrompt(id: string) {
    if (!confirm("Delete this meta-prompt?")) return;
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
        <div className="animate-pulse space-y-4">
          {[1, 2, 3].map((i) => (<div key={i} className="h-24 bg-muted rounded-lg" />))}
        </div>
      </div>
    );
  }

  return (
    <div className="py-6">
      <Breadcrumbs items={[{ label: "Templates", href: "/templates" }, { label: "Meta-Prompts" }]} />

      <div className="flex items-center justify-between mb-6 mt-4">
        <h1 className="text-2xl font-bold">Meta-Prompts</h1>
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
              <Button onClick={create} disabled={creating || !newName.trim() || !newContent.trim()} className="w-full">
                {creating && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Create
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {metaPrompts.length === 0 ? (
        <div className="text-center py-16 space-y-4">
          <Wand2 className="h-12 w-12 mx-auto text-muted-foreground" />
          <p className="text-muted-foreground">No meta-prompts yet.</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {metaPrompts.map((mp) => (
            <Card key={mp.id} className="group relative hover:border-brand-200 dark:hover:border-brand-800 hover:shadow-sm transition-all duration-200">
              <Link href={`/templates/metaprompts/${mp.id}`}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base group-hover:text-primary transition-colors">{mp.name}</CardTitle>
                </CardHeader>
                <CardContent>
                  {mp.description ? (
                    <CardDescription className="line-clamp-2">{mp.description}</CardDescription>
                  ) : (
                    <CardDescription className="italic">No description</CardDescription>
                  )}
                  <p className="text-xs text-muted-foreground mt-2 font-mono line-clamp-2">{mp.content.slice(0, 120)}</p>
                </CardContent>
              </Link>
              <Button
                variant="ghost" size="icon"
                className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                onClick={(e) => { e.preventDefault(); deleteMetaPrompt(mp.id); }}
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
