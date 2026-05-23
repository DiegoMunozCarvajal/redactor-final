"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Sparkles, Save } from "lucide-react";
import { toast } from "sonner";
import { MODEL_OPTIONS, EFFORT_OPTIONS } from "@/lib/ai/providers";

interface Props {
  projectId: string;
  chapterId: string;
  initialContent: string | null;
  onSaved?: (content: string) => void;
}

export function ChapterBriefSection({ projectId, chapterId, initialContent, onSaved }: Props) {
  const [content, setContent] = useState(initialContent ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setContent(initialContent ?? "");
  }, [initialContent]);
  const [generating, setGenerating] = useState(false);
  const [briefModel, setBriefModel] = useState("deepseek-v4-pro");
  const [briefEffort, setBriefEffort] = useState("max");
  const [briefTemperature, setBriefTemperature] = useState(0.7);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/chapters/${chapterId}/brief`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (res.ok) {
        toast.success("Brief saved");
        onSaved?.(content);
      } else {
        toast.error("Error saving brief");
      }
    } catch (err) {
      console.error("brief save failed:", err);
      toast.error("Network error");
    } finally {
      setSaving(false);
    }
  }

  async function generate() {
    setGenerating(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/chapters/${chapterId}/brief/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: briefModel, effort: briefEffort, temperature: briefTemperature }),
      });
      if (res.ok) {
        const data = await res.json();
        setContent(data?.content ?? "");
        toast.success("Brief generated");
      } else {
        toast.error("Error generating brief");
      }
    } catch (err) {
      console.error("brief generate failed:", err);
      toast.error("Network error");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="mb-6">
      <h2 className="text-sm font-medium text-muted-foreground mb-3">Chapter Brief</h2>
      <Card>
        <CardContent className="pt-4 space-y-3">
          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="text-xs min-h-[80px]"
            placeholder="A brief description of this chapter's scope, target reader, and desired outcome..."
          />
          <div className="flex justify-end gap-2">
            <Select value={briefModel} onValueChange={setBriefModel}>
              <SelectTrigger className="w-[110px] h-7 text-[10px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MODEL_OPTIONS.map((m) => (
                  <SelectItem key={m.id} value={m.id} className="text-[10px]">{m.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={briefEffort} onValueChange={setBriefEffort}>
              <SelectTrigger className="w-[70px] h-7 text-[10px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EFFORT_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value} className="text-[10px]">{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {briefEffort === "off" && (
              <Input
                type="number"
                min={0}
                max={1}
                step={0.1}
                value={briefTemperature}
                onChange={(e) => { const v = parseFloat(e.target.value); setBriefTemperature(isNaN(v) ? 0.7 : v); }}
                className="w-[60px] h-7 text-[10px] px-1"
              />
            )}
            <Button
              size="sm"
              variant="outline"
              className="text-xs"
              onClick={generate}
              disabled={generating}
            >
              {generating ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Sparkles className="h-3 w-3 mr-1" />}
              Generate with AI
            </Button>
            <Button size="sm" className="text-xs" onClick={save} disabled={saving || generating}>
              {saving ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Save className="h-3 w-3 mr-1" />}
              Save
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
