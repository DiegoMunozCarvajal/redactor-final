"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";

export default function AssemblyPromptEditorPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    fetch(`/api/assembly-prompts/${params.id}`, { signal: controller.signal })
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((ap) => { setName(ap.name); setDescription(ap.description ?? ""); setContent(ap.content); })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Failed to load");
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [params.id]);

  async function save() {
    if (!name.trim() || !content.trim()) return;
    setSaving(true);
    const res = await fetch(`/api/assembly-prompts/${params.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), description: description.trim() || null, content }),
    });
    if (res.ok) {
      toast.success("Saved");
    } else {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error ?? "Error saving");
    }
    setSaving(false);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="py-20 text-center">
        <p className="text-destructive mb-4">{error}</p>
        <Button variant="outline" onClick={() => router.push("/templates/assemblies")}>Back to Assembly Prompts</Button>
      </div>
    );
  }

  return (
    <div className="py-6">
      <Breadcrumbs items={[
        { label: "Templates", href: "/templates" },
        { label: "Assembly Prompts", href: "/templates/assemblies" },
        { label: name || "..." },
      ]} />

      <div className="mt-6 space-y-6 max-w-3xl">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Edit Assembly Prompt</h1>
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
            Save
          </Button>
        </div>

        <div className="space-y-2">
          <Label htmlFor="name">Name</Label>
          <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="desc">Description</Label>
          <Input id="desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional description" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="content">System Prompt</Label>
          <Textarea id="content" value={content} onChange={(e) => setContent(e.target.value)} rows={20} className="font-mono text-xs" />
        </div>
      </div>
    </div>
  );
}
