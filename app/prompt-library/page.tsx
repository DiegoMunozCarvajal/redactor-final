"use client";

import { useEffect, useState, useCallback, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { PageHeader } from "@/components/patterns/page-header";
import { EmptyState } from "@/components/patterns/empty-state";
import { ResourceCard } from "@/components/patterns/resource-card";
import { LoadingSkeleton } from "@/components/patterns/loading-skeleton";
import { Loader2, Plus, Puzzle, MessageSquareQuote, Wrench } from "lucide-react";
import { toast } from "sonner";

interface PromptLibraryItem {
  id: string;
  category: string;
  name: string;
  description: string | null;
  content: string;
  userPrompt: string | null;
  createdAt: string;
  updatedAt: string;
}

const TAB_OPTIONS = [
  { value: "assembly", label: "Assembly", icon: Puzzle, description: "Assembly prompts merge content fragments into a unified chapter." },
  { value: "critique", label: "Critique", icon: MessageSquareQuote, description: "Critique prompts analyze assembled chapter content and provide structured feedback." },
  { value: "corrector", label: "Corrector", icon: Wrench, description: "Corrector prompts apply critique findings to fix continuity and language issues in chapters." },
] as const;

function PromptLibraryContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeTab = searchParams.get("tab") ?? "assembly";

  const [items, setItems] = useState<PromptLibraryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newContent, setNewContent] = useState("");
  const [newUserPrompt, setNewUserPrompt] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const currentTab = TAB_OPTIONS.find((t) => t.value === activeTab) ?? TAB_OPTIONS[0];

  const fetchItems = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch(`/api/prompt-library?category=${activeTab}`, { signal });
      if (res.ok) setItems(await res.json());
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      toast.error("Could not connect to server");
    }
    setLoading(false);
  }, [activeTab]);

  useEffect(() => {
    setLoading(true);
    const controller = new AbortController();
    fetchItems(controller.signal);
    return () => controller.abort();
  }, [fetchItems]);

  function onTabChange(value: string) {
    setLoading(true);
    router.push(`/prompt-library?tab=${value}`);
  }

  async function create() {
    if (!newName.trim() || !newContent.trim()) return;
    setCreating(true);
    const res = await fetch("/api/prompt-library", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category: activeTab, name: newName.trim(), description: newDescription.trim() || null, content: newContent, userPrompt: newUserPrompt.trim() || null }),
    });
    if (res.ok) {
      setCreateOpen(false);
      setNewName("");
      setNewDescription("");
      setNewContent("");
      setNewUserPrompt("");
      router.refresh();
      fetchItems();
      toast.success(`${currentTab.label} prompt created`);
    } else {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error ?? "Error creating");
    }
    setCreating(false);
  }

  async function deleteItem(id: string) {
    setDeleteTarget(id);
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    const id = deleteTarget;
    setDeleteTarget(null);
    const res = await fetch(`/api/prompt-library/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Failed to delete" }));
      toast.error(err.error ?? "Failed to delete");
      return;
    }
    fetchItems();
    toast.success(`${currentTab.label} prompt deleted`);
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
        breadcrumbs={[{ label: "Prompt Library" }]}
        title="Prompt Library"
      >
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4" /> New {currentTab.label} Prompt</Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Create {currentTab.label} Prompt</DialogTitle>
              <DialogDescription>
                {currentTab.description}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input id="name" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={`e.g. Default Chapter ${currentTab.label}`} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="desc">Description (optional)</Label>
                <Input id="desc" value={newDescription} onChange={(e) => setNewDescription(e.target.value)} placeholder="When to use this prompt" />
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

      <Tabs value={activeTab} onValueChange={onTabChange} className="mt-6">
        <TabsList>
          {TAB_OPTIONS.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value}>
              <tab.icon className="h-4 w-4 mr-2" />
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {items.length === 0 ? (
        <EmptyState
          icon={currentTab.icon}
          title={`No ${currentTab.label.toLowerCase()} prompts yet`}
          description={`Create your first ${currentTab.label.toLowerCase()} prompt to get started.`}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 mt-6">
          {items.map((item) => (
            <ResourceCard
              key={item.id}
              href={`/prompt-library/${item.id}`}
              title={item.name}
              description={item.description}
              onDelete={() => deleteItem(item.id)}
            >
              {item.userPrompt ? (
                <p className="text-xs text-muted-foreground mt-2 line-clamp-2">User: {item.userPrompt.slice(0, 120)}</p>
              ) : (
                <p className="text-xs text-muted-foreground mt-2 line-clamp-2">{item.content.slice(0, 120)}</p>
              )}
            </ResourceCard>
          ))}
        </div>
      )}
      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        description={`Delete this ${currentTab.label.toLowerCase()} prompt?`}
        onConfirm={confirmDelete}
      />
    </div>
  );
}

export default function PromptLibraryPage() {
  return (
    <Suspense>
      <PromptLibraryContent />
    </Suspense>
  );
}
