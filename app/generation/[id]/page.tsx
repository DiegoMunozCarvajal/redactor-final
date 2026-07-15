"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { PageHeader } from "@/components/patterns/page-header";
import { LoadingSkeleton } from "@/components/patterns/loading-skeleton";
import { PromptRevisionEditor } from "@/components/prompts/prompt-revision-editor";
import type { RevisionSummary } from "@/components/prompts/prompt-revision-editor";
import { KIND_LABELS } from "@/components/prompts/prompt-definition-list";
import type { PromptKind } from "@/lib/db/schema/prompt-registry";
import { ArrowLeft, Archive, ArchiveRestore, Pencil, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface DefinitionDetail {
  id: string;
  name: string;
  kind: PromptKind;
  description: string | null;
  archivedAt: string | null;
  revisions: RevisionSummary[];
  defaultRevisionId: string | null;
}

export default function GenerationDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [definition, setDefinition] = useState<DefinitionDetail | null>(null);
  const [loading, setLoading] = useState(true);

  // Metadata edit
  const [metaOpen, setMetaOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const fetchDefinition = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch(`/api/prompt-definitions/${params.id}`, { signal });
      if (!res.ok) {
        router.push("/generation");
        return;
      }
      setDefinition(await res.json());
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      toast.error("Could not connect to server");
    }
    setLoading(false);
  }, [params.id, router]);

  useEffect(() => {
    const controller = new AbortController();
    fetchDefinition(controller.signal);
    return () => controller.abort();
  }, [fetchDefinition]);

  async function saveMetadata() {
    setSaving(true);
    const res = await fetch(`/api/prompt-definitions/${params.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: editName.trim(),
        description: editDescription.trim() || null,
      }),
    });
    if (res.ok) {
      setMetaOpen(false);
      fetchDefinition();
      toast.success("Metadatos actualizados");
    } else {
      const body = await res.json().catch(() => ({}));
      toast.error(body.error ?? "Error al actualizar");
    }
    setSaving(false);
  }

  async function toggleArchived(archived: boolean) {
    const res = await fetch(`/api/prompt-definitions/${params.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archived }),
    });
    if (res.ok) {
      fetchDefinition();
      toast.success(archived ? "Definición archivada" : "Definición restaurada");
    } else {
      const body = await res.json().catch(() => ({}));
      if (res.status === 409 && body.blockers) {
        toast.error(
          `No se puede archivar: ${body.blockers.defaultCount} defaults, ${body.blockers.bindingCount} bindings`,
        );
        return;
      }
      toast.error(body.error ?? "Error");
    }
  }

  if (loading) return <LoadingSkeleton />;
  if (!definition) return null;

  const kindLabel = KIND_LABELS[definition.kind] ?? definition.kind;
  const isArchived = !!definition.archivedAt;

  return (
    <div className="space-y-6">
      <PageHeader
        title={definition.name}
        subtitle={
          definition.description
            ? `${kindLabel} · ${definition.description}`
            : kindLabel
        }
      >
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => {
              setEditName(definition.name);
              setEditDescription(definition.description ?? "");
              setMetaOpen(true);
            }}
          >
            <Pencil className="h-4 w-4 mr-2" />Editar
          </Button>

          {isArchived ? (
            <Button
              variant="outline"
              onClick={() => toggleArchived(false)}
            >
              <ArchiveRestore className="h-4 w-4 mr-2" />Restaurar
            </Button>
          ) : (
            <Button
              variant="outline"
              onClick={() => setArchiveConfirmOpen(true)}
            >
              <Archive className="h-4 w-4 mr-2" />Archivar
            </Button>
          )}

          <Button variant="outline" onClick={() => router.push("/generation")}>
            <ArrowLeft className="h-4 w-4 mr-2" />Volver
          </Button>
        </div>
      </PageHeader>

      {isArchived && (
        <div className="px-4 py-3 bg-amber-50 border border-amber-200 rounded text-sm text-amber-800 dark:bg-amber-950 dark:border-amber-800 dark:text-amber-200">
          Esta definición está archivada desde {definition.archivedAt!.slice(0, 10)}.
        </div>
      )}

      <PromptRevisionEditor
        definitionId={definition.id}
        definitionName={definition.name}
        kind={definition.kind}
        archived={isArchived}
        currentDefaultRevisionId={definition.defaultRevisionId}
        revisions={definition.revisions}
        onChanged={() => fetchDefinition()}
      />

      {/* Metadata dialog */}
      <Dialog open={metaOpen} onOpenChange={setMetaOpen}>
        <DialogTrigger asChild>
          <span />
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar metadatos</DialogTitle>
            <DialogDescription>
              Cambia el nombre o descripción de esta definición.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="edit-name">Nombre</Label>
              <Input
                id="edit-name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="edit-desc">Descripción</Label>
              <Input
                id="edit-desc"
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
              />
            </div>
            <Button
              onClick={saveMetadata}
              disabled={saving || !editName.trim()}
              className="w-full"
            >
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Guardar
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Archive confirmation dialog */}
      <Dialog open={archiveConfirmOpen} onOpenChange={setArchiveConfirmOpen}>
        <DialogTrigger asChild>
          <span />
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>¿Archivar definición?</DialogTitle>
            <DialogDescription>
              Una definición archivada no se usará en ejecuciones. Solo se puede
              archivar si no tiene defaults ni bindings activos.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setArchiveConfirmOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() => {
                setArchiveConfirmOpen(false);
                toggleArchived(true);
              }}
            >
              Archivar
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
