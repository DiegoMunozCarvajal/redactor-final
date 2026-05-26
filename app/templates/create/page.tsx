"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Loader2, Upload, X, FileText, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";

interface MetaPrompt {
  id: string;
  name: string;
}

interface ChapterFile {
  name: string;
  contentMd: string;
}

export default function CreateTemplatePage() {
  const router = useRouter();
  const [metaPrompts, setMetaPrompts] = useState<MetaPrompt[]>([]);
  const [loadingMeta, setLoadingMeta] = useState(true);
  const [templateName, setTemplateName] = useState("");
  const [templateDescription, setTemplateDescription] = useState("");
  const [selectedMetaPromptId, setSelectedMetaPromptId] = useState("");
  const [chapters, setChapters] = useState<ChapterFile[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch("/api/meta-prompts")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setMetaPrompts(data);
      })
      .catch(() => toast.error("Failed to load meta-prompts"))
      .finally(() => setLoadingMeta(false));
  }, []);

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files) return;

    const readers: Promise<ChapterFile>[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      readers.push(
        new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve({ name: file.name.replace(/\.md$/i, ""), contentMd: reader.result as string });
          reader.onerror = reject;
          reader.readAsText(file);
        })
      );
    }

    Promise.all(readers).then((newChapters) => {
      setChapters((prev) => {
        const existing = new Set(prev.map((c) => c.name));
        const unique = newChapters.filter((c) => !existing.has(c.name));
        return [...prev, ...unique].sort((a, b) => a.name.localeCompare(b.name));
      });
    });
  }

  function removeChapter(name: string) {
    setChapters((prev) => prev.filter((c) => c.name !== name));
  }

  async function handleSubmit() {
    if (!templateName.trim() || !selectedMetaPromptId || chapters.length === 0) {
      toast.error("Name, meta-prompt, and at least one chapter are required");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/books/auto", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: templateName.trim(),
          description: templateDescription.trim() || null,
          metaPromptId: selectedMetaPromptId,
          chapters,
        }),
      });

      if (res.ok) {
        toast.success("Template created! Prompts are being generated in the background.");
        router.push("/templates");
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error ?? "Failed to create template");
      }
    } catch {
      toast.error("Network error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="py-6">
      <Breadcrumbs items={[
        { label: "Templates", href: "/templates" },
        { label: "Create from Meta-Prompt" },
      ]} />

      <div className="mt-6 max-w-2xl space-y-8">
        <div>
          <Link href="/templates" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-4">
            <ArrowLeft className="h-3 w-3" /> Back to templates
          </Link>
          <h1 className="text-2xl font-bold">Generate Template from Meta-Prompt</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Upload source chapters in Markdown. The meta-prompt will analyze each chapter&rsquo;s architecture and generate content-creating prompts.
          </p>
        </div>

        {/* Template info */}
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Template Name</Label>
            <Input id="name" value={templateName} onChange={(e) => setTemplateName(e.target.value)} placeholder="e.g. Atomic Habits Style" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="desc">Description (optional)</Label>
            <Textarea id="desc" value={templateDescription} onChange={(e) => setTemplateDescription(e.target.value)} placeholder="What kind of books this template produces" rows={2} />
          </div>
        </div>

        {/* Meta-prompt selector */}
        <div className="space-y-2">
          <Label htmlFor="metaPrompt">Meta-Prompt</Label>
          {loadingMeta ? (
            <div className="h-10 bg-muted animate-pulse rounded-md" />
          ) : metaPrompts.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              No meta-prompts available.{" "}
              <Link href="/meta-prompts" className="text-primary hover:underline">Create one first</Link>.
            </div>
          ) : (
            <select
              id="metaPrompt"
              value={selectedMetaPromptId}
              onChange={(e) => setSelectedMetaPromptId(e.target.value)}
              className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Select a meta-prompt...</option>
              {metaPrompts.map((mp) => (
                <option key={mp.id} value={mp.id}>{mp.name}</option>
              ))}
            </select>
          )}
        </div>

        {/* Chapter upload */}
        <div className="space-y-4">
          <div>
            <Label>Source Chapters (.md files)</Label>
            <p className="text-xs text-muted-foreground mt-1">
              Upload one .md file per chapter. Each file becomes &ldquo;Chapter 1&rdquo;, &ldquo;Chapter 2&rdquo;, etc. in order.
            </p>
          </div>

          <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-lg cursor-pointer hover:bg-accent/50 transition-colors">
            <div className="flex flex-col items-center justify-center pt-5 pb-6">
              <Upload className="h-8 w-8 text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">Click to upload .md files</p>
            </div>
            <input
              type="file"
              accept=".md,.txt,.markdown"
              multiple
              onChange={handleFileUpload}
              className="hidden"
            />
          </label>

          {chapters.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium">{chapters.length} chapter{chapters.length !== 1 ? "s" : ""} loaded:</p>
              <div className="space-y-1">
                {chapters.map((ch, i) => (
                  <Card key={ch.name} className="py-2 px-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <FileText className="h-3 w-3 text-muted-foreground" />
                        <span className="text-xs font-mono text-muted-foreground">Capítulo {i + 1}:</span>
                        <span className="text-sm">{ch.name}</span>
                        <span className="text-xs text-muted-foreground">({ch.contentMd.length.toLocaleString()} chars)</span>
                      </div>
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => removeChapter(ch.name)}>
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </div>

        <Button
          onClick={handleSubmit}
          disabled={submitting || !templateName.trim() || !selectedMetaPromptId || chapters.length === 0}
          className="w-full"
        >
          {submitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              Creating template...
            </>
          ) : (
            "Generate Template"
          )}
        </Button>
      </div>
    </div>
  );
}
