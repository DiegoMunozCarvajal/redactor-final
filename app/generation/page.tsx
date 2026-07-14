"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/patterns/page-header";
import { LoadingSkeleton } from "@/components/patterns/loading-skeleton";
import { PromptDefinitionList, KIND_LABELS } from "@/components/prompts/prompt-definition-list";
import type { PromptDefinitionSummary } from "@/components/prompts/prompt-definition-list";
import { promptKindValues } from "@/lib/db/schema/prompt-registry";
import type { PromptKind } from "@/lib/db/schema/prompt-registry";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

const DEFAULT_KIND: PromptKind = "generation-system";

export default function GenerationPage() {
  const router = useRouter();
  const [allDefinitions, setAllDefinitions] = useState<PromptDefinitionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeKind, setActiveKind] = useState<PromptKind>(DEFAULT_KIND);
  const [defaults, setDefaults] = useState<Record<string, string | null>>({});

  // Create dialog state
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");

  const fetchAll = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch("/api/prompt-definitions", { signal });
      if (res.ok) {
        const data = await res.json();
        setAllDefinitions(data);
      } else {
        toast.error("Failed to load prompt definitions");
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      toast.error("Could not connect to server");
    }
    setLoading(false);
  }, []);

  const fetchDefaults = useCallback(async (signal?: AbortSignal) => {
    const map: Record<string, string | null> = {};
    for (const kind of promptKindValues) {
      try {
        const res = await fetch(`/api/prompt-defaults/${kind}`, { signal });
        if (res.ok) {
          const data = await res.json();
          map[kind] = data.promptRevisionId;
        }
      } catch {
        // Default not configured for this kind
      }
    }
    setDefaults(map);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([fetchAll(controller.signal), fetchDefaults(controller.signal)]);
    return () => controller.abort();
  }, [fetchAll, fetchDefaults]);

  async function createDefinition() {
    if (!newName.trim()) return;
    setCreating(true);
    const res = await fetch("/api/prompt-definitions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: activeKind,
        name: newName.trim(),
        description: newDescription.trim() || null,
      }),
    });
    if (res.ok) {
      setCreateOpen(false);
      setNewName("");
      setNewDescription("");
      fetchAll();
      toast.success("Definición creada");
    } else {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error ?? "Error al crear");
    }
    setCreating(false);
  }

  const definitionsForKind = allDefinitions.filter((d) => d.kind === activeKind);

  if (loading) return <LoadingSkeleton />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Prompts"
        subtitle="Administración de definiciones y revisiones inmutables de prompts."
      />

      <Tabs value={activeKind} onValueChange={(v) => setActiveKind(v as PromptKind)}>
        <TabsList className="flex-wrap h-auto gap-1 mb-4">
          {promptKindValues.map((kind) => (
            <TabsTrigger key={kind} value={kind} className="text-xs">
              {KIND_LABELS[kind]}
            </TabsTrigger>
          ))}
        </TabsList>

        {promptKindValues.map((kind) => (
          <TabsContent key={kind} value={kind}>
            <PromptDefinitionList
              kind={kind}
              definitions={definitionsForKind}
              currentDefaultRevisionId={defaults[kind] ?? null}
              onCreate={() => {
                setActiveKind(kind);
                setCreateOpen(true);
              }}
            />
          </TabsContent>
        ))}
      </Tabs>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogTrigger asChild>
          <span />
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nueva definición — {KIND_LABELS[activeKind]}</DialogTitle>
            <DialogDescription>
              Crea una definición de prompt. Las revisiones se añaden después.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="name">Nombre</Label>
              <Input
                id="name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Assembly v1"
              />
            </div>
            <div>
              <Label htmlFor="desc">Descripción (opcional)</Label>
              <Input
                id="desc"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder="Prompt de ensamblaje principal"
              />
            </div>
            <Button onClick={createDefinition} disabled={creating || !newName.trim()} className="w-full">
              {creating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Crear definición
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
