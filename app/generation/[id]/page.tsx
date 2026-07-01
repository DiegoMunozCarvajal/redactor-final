"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/patterns/page-header";
import { LoadingSkeleton } from "@/components/patterns/loading-skeleton";
import { Loader2, ArrowLeft } from "lucide-react";
import { toast } from "sonner";

interface GenerationPrompt {
  id: string;
  name: string;
  description: string | null;
  content: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export default function GenerationEditPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [prompt, setPrompt] = useState<GenerationPrompt | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const [isDefault, setIsDefault] = useState(false);

  const fetchPrompt = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch(`/api/generation-prompts/${params.id}`, { signal });
      if (!res.ok) { router.push("/generation"); return; }
      const data = await res.json();
      setPrompt(data);
      setName(data.name);
      setContent(data.content);
      setIsDefault(data.isDefault);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      toast.error("Could not connect to server");
    }
    setLoading(false);
  }, [params.id, router]);

  useEffect(() => {
    const controller = new AbortController();
    fetchPrompt(controller.signal);
    return () => controller.abort();
  }, [fetchPrompt]);

  async function save() {
    if (!name.trim() || !content.trim()) return;
    setSaving(true);
    const res = await fetch(`/api/generation-prompts/${params.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), content, is_default: isDefault }),
    });
    if (res.ok) {
      const updated = await res.json();
      setPrompt(updated);
      toast.success("Saved");
    } else {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error ?? "Error saving");
    }
    setSaving(false);
  }

  const [deleteOpen, setDeleteOpen] = useState(false);

  async function confirmDelete() {
    setDeleteOpen(false);
    const res = await fetch(`/api/generation-prompts/${params.id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("Failed to delete");
      return;
    }
    toast.success("Deleted");
    router.push("/generation");
  }

  if (loading) return <LoadingSkeleton />;
  if (!prompt) return null;

  const wordCount = content.split(/\s+/).filter(Boolean).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title={name}
        subtitle={`${wordCount} words · ${content.length} chars · updated ${prompt.updatedAt.slice(0, 10)}`}
      >
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => router.push("/generation")}>
            <ArrowLeft className="h-4 w-4 mr-2" />Back
          </Button>
          <Button variant="destructive" onClick={() => setDeleteOpen(true)}>Delete</Button>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Save
          </Button>
        </div>
      </PageHeader>

      <div className="space-y-4">
        <div>
          <Label htmlFor="name">Name</Label>
          <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>

        <div>
          <Label htmlFor="content">System Prompt</Label>
          <Textarea
            id="content"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="font-mono text-xs min-h-[500px]"
          />
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={isDefault}
            onChange={(e) => setIsDefault(e.target.checked)}
          />
          Default — use this prompt for all fragment generation
        </label>
      </div>
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        description="Delete this generation prompt? This cannot be undone."
        onConfirm={confirmDelete}
      />
    </div>
  );
}
