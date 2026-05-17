"use client";

import { useState } from "react";
import type { Prompt } from "@/lib/db/schema";

const PROMPT_TYPES = [
  "apertura", "modelo", "contraste", "amplificacion",
  "anecdota", "acumulacion", "proceso", "cierre", "ensamblaje",
];

export function PromptEditor({
  prompt,
  onSave,
  onDelete,
}: {
  prompt: Prompt;
  onSave: (p: Prompt) => void;
  onDelete: (id: string) => void;
}) {
  const [type, setType] = useState(prompt.type);
  const [title, setTitle] = useState(prompt.title);
  const [content, setContent] = useState(prompt.content);
  const [styleRules, setStyleRules] = useState(prompt.styleRules ?? "");
  const [knowledgeAreas, setKnowledgeAreas] = useState(prompt.knowledgeAreas ?? "");
  const [suggestedLength, setSuggestedLength] = useState(prompt.suggestedLength ?? "");
  const [saving, setSaving] = useState(false);

  function insertTopic() {
    setContent((c) => c + " [TEMA]");
  }

  async function handleSave() {
    setSaving(true);
    const res = await fetch(`/api/prompts/${prompt.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, title, content, styleRules, knowledgeAreas, suggestedLength }),
    });
    const updated = await res.json();
    onSave(updated);
    setSaving(false);
  }

  async function handleDelete() {
    await fetch(`/api/prompts/${prompt.id}`, { method: "DELETE" });
    onDelete(prompt.id);
  }

  return (
    <div className="border rounded-lg p-4 space-y-3">
      <div className="flex items-center gap-2">
        <select
          value={type}
          onChange={(e) => setType(e.target.value)}
          className="text-sm border rounded px-2 py-1"
        >
          {PROMPT_TYPES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Título del prompt"
          className="flex-1 bg-transparent border-b px-1 text-sm font-medium focus:outline-none focus:border-primary"
        />
        <button onClick={handleDelete} className="text-xs text-destructive">Delete</button>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs text-muted-foreground">Content</label>
          <button onClick={insertTopic} type="button" className="text-xs px-2 py-0.5 bg-muted rounded hover:bg-accent">
            Insert [TEMA]
          </button>
        </div>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={12}
          className="w-full border rounded-md p-3 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-muted-foreground">Style Rules</label>
          <textarea
            value={styleRules}
            onChange={(e) => setStyleRules(e.target.value)}
            rows={3}
            className="w-full border rounded-md p-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Knowledge Areas</label>
          <textarea
            value={knowledgeAreas}
            onChange={(e) => setKnowledgeAreas(e.target.value)}
            rows={3}
            className="w-full border rounded-md p-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Suggested Length</label>
          <input
            value={suggestedLength}
            onChange={(e) => setSuggestedLength(e.target.value)}
            className="w-full border rounded-md p-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
      </div>

      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save"}
        </button>
      </div>
    </div>
  );
}
