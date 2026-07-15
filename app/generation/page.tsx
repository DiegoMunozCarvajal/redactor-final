"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { PageHeader } from "@/components/patterns/page-header";
import { LoadingSkeleton } from "@/components/patterns/loading-skeleton";
import { PromptDefinitionList } from "@/components/prompts/prompt-definition-list";
import { PromptKindNav } from "@/components/prompts/prompt-kind-nav";
import type { DefinitionSummary } from "@/lib/prompts/admin-types";
import { parsePromptKind, KIND_LABELS } from "@/lib/prompts/kinds";
import type { PromptKind } from "@/lib/db/schema/prompt-registry";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

export default function GenerationPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const activeKind = parsePromptKind(searchParams.get("kind"));
  const archive =
    searchParams.get("archive") === "archived" ? "archived" : "active";

  const [definitions, setDefinitions] = useState<DefinitionSummary[]>([]);
  const [loading, setLoading] = useState(true);

  // Create dialog state
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");

  function replaceQuery(next: { kind?: PromptKind; archive?: "active" | "archived" }) {
    const params = new URLSearchParams(searchParams.toString());
    if (next.kind) params.set("kind", next.kind);
    if (next.archive === "archived") params.set("archive", "archived");
    if (next.archive === "active") params.delete("archive");
    router.replace(`/generation?${params.toString()}`);
  }

  const fetchDefinitions = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/prompt-definitions?kind=${activeKind}&archive=${archive}`,
          { signal },
        );
        if (res.ok) {
          const data = await res.json();
          setDefinitions(data as DefinitionSummary[]);
        } else {
          toast.error("Failed to load prompt definitions");
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        toast.error("Could not connect to server");
      }
      setLoading(false);
    },
    [activeKind, archive],
  );

  useEffect(() => {
    const controller = new AbortController();
    fetchDefinitions(controller.signal);
    return () => controller.abort();
  }, [fetchDefinitions]);

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
      fetchDefinitions();
      toast.success("Definición creada");
    } else {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error ?? "Error al crear");
    }
    setCreating(false);
  }

  if (loading) return <LoadingSkeleton />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Prompts"
        subtitle="Administración de definiciones y revisiones inmutables de prompts."
      />

      <Tabs
        value={activeKind}
        onValueChange={(v) => {
          const kind = v as PromptKind;
          replaceQuery({ kind, archive });
        }}
      >
        <PromptKindNav
          value={activeKind}
          onValueChange={(kind) => replaceQuery({ kind, archive })}
        />

        <TabsContent value={activeKind} className="mt-4">
          <PromptDefinitionList
            kind={activeKind}
            definitions={definitions}
            onCreate={() => setCreateOpen(true)}
          />
        </TabsContent>
      </Tabs>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogTrigger asChild>
          <span />
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Nueva definición — {KIND_LABELS[activeKind]}
            </DialogTitle>
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
            <Button
              onClick={createDefinition}
              disabled={creating || !newName.trim()}
              className="w-full"
            >
              {creating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Crear definición
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
