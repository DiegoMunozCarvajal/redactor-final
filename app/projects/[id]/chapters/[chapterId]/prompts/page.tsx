"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card";
import { Loader2, Plus, Trash2 } from "lucide-react";

interface ProjectPrompt {
  id: string;
  chapterId: string;
  position: number;
  isAssembly: boolean;
  title: string;
  content: string;
}

export default function PromptsPage() {
  const params = useParams<{ id: string; chapterId: string }>();
  const [prompts, setPrompts] = useState<ProjectPrompt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [showNew, setShowNew] = useState(false);
  const [newPrompt, setNewPrompt] = useState({
    isAssembly: false,
    title: "",
    content: "",
  });

  async function fetchPrompts(signal?: AbortSignal) {
    try {
      const res = await fetch(
        `/api/projects/${params.id}/prompts?chapterId=${params.chapterId}`,
        { signal },
      );
      if (signal?.aborted) return;
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      setPrompts(await res.json());
    } catch (err) {
      if (signal?.aborted) return;
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    fetchPrompts(controller.signal);
    return () => controller.abort();
  }, [params.id, params.chapterId]);

  async function savePrompt(promptId: string, field: string, value: string) {
    setSaving((s) => ({ ...s, [promptId]: true }));
    try {
      await fetch(`/api/projects/${params.id}/prompts/${promptId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value }),
      });
    } catch {
      setError("Failed to save");
    } finally {
      setSaving((s) => ({ ...s, [promptId]: false }));
    }
  }

  async function addPrompt() {
    try {
      const res = await fetch(`/api/projects/${params.id}/prompts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...newPrompt, chapterId: params.chapterId }),
      });
      if (res.ok) {
        setShowNew(false);
        setNewPrompt({ isAssembly: false, title: "", content: "" });
        fetchPrompts();
      } else {
        setError("Failed to add prompt");
      }
    } catch {
      setError("Failed to add prompt");
    }
  }

  async function deletePrompt(promptId: string) {
    try {
      await fetch(`/api/projects/${params.id}/prompts/${promptId}`, {
        method: "DELETE",
      });
      fetchPrompts();
    } catch {
      setError("Failed to delete prompt");
    }
  }

  if (loading)
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );

  if (error) {
    return (
      <div className="py-20 text-center">
        <p className="text-destructive">{error}</p>
        <Link
          href={`/projects/${params.id}`}
          className="text-sm text-primary hover:underline"
        >
          Back to project
        </Link>
      </div>
    );
  }

  return (
    <div className="py-6">
      <Breadcrumbs
        items={[
          { label: "Projects", href: "/projects" },
          { label: "Project", href: `/projects/${params.id}` },
          { label: "Prompts" },
        ]}
      />

      <div className="flex items-center justify-between mt-4 mb-6">
        <h1 className="text-xl font-bold">Chapter Prompts</h1>
        <Button onClick={() => setShowNew(true)} disabled={showNew}>
          <Plus className="h-4 w-4 mr-1" /> Add Prompt
        </Button>
      </div>

      {showNew && (
        <Card className="mb-4 border-brand-200">
          <CardContent className="pt-4 space-y-3">
            <div>
              <Label>Title</Label>
              <Input
                value={newPrompt.title}
                onChange={(e) =>
                  setNewPrompt((p) => ({ ...p, title: e.target.value }))
                }
              />
            </div>
            <div>
              <Label>Content</Label>
              <Textarea
                value={newPrompt.content}
                onChange={(e) =>
                  setNewPrompt((p) => ({ ...p, content: e.target.value }))
                }
                rows={4}
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={addPrompt}>Save</Button>
              <Button variant="ghost" onClick={() => setShowNew(false)}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="space-y-4">
        {prompts.map((prompt) => (
          <Card key={prompt.id}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">
                  <span className="text-muted-foreground">
                    {prompt.position + 1}.
                  </span>{" "}
                  {prompt.title}
                </CardTitle>
                <div className="flex items-center gap-1">
                  {saving[prompt.id] && (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  )}
                  <Button
                    size="icon"
                    variant="ghost"
                    className="text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                    onClick={() => deletePrompt(prompt.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label className="text-xs text-muted-foreground">
                  Content
                </Label>
                <Textarea
                  defaultValue={prompt.content}
                  onBlur={(e) => {
                    if (e.target.value !== prompt.content)
                      savePrompt(prompt.id, "content", e.target.value);
                  }}
                  rows={3}
                  className="text-sm"
                />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
