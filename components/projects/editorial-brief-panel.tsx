"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EditorialBriefForm } from "./editorial-brief-form";
import { ChapterContractEditor } from "./chapter-contract-editor";
import { Loader2, FileText, CheckCircle, History, Plus, Upload } from "lucide-react";
import { toast } from "sonner";
import type { EditorialBundle } from "@/lib/editorial-brief/schema";
import { isEditorialBriefContentV3 } from "@/lib/editorial-brief/schema";

interface EditorialBriefPanelProps {
  projectId: string;
  sourcesVersion?: number;
}

interface BriefListResponse {
  active: EditorialBundle | null;
  draft: EditorialBundle | null;
  history: Array<{
    id: string;
    version: number;
    status: "draft" | "approved" | "archived";
    contentHash: string;
    approvedAt: string | null;
    createdAt: string;
  }>;
}

interface ProjectSource {
  id: string;
  fileName: string;
}

export function EditorialBriefPanel({ projectId, sourcesVersion = 0 }: EditorialBriefPanelProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<BriefListResponse | null>(null);
  const [draftContent, setDraftContent] = useState<EditorialBundle | null>(null);
  const [showApproveConfirm, setShowApproveConfirm] = useState(false);
  const [showNewVersion, setShowNewVersion] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deletingDraft, setDeletingDraft] = useState(false);
  const [sources, setSources] = useState<ProjectSource[]>([]);
  const [sourcesLoading, setSourcesLoading] = useState(false);
  const [selectedSourceId, setSelectedSourceId] = useState<string>("");
  const [uploadingSource, setUploadingSource] = useState(false);
  const [uploadSourceKind, setUploadSourceKind] = useState<"reference" | "example">("reference");
  const uploadFileRef = useRef<HTMLInputElement>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/editorial-briefs`);
      if (!res.ok) throw new Error(`Failed to load (${res.status})`);
      const json = await res.json();
      setData(json);
      setDraftContent(json.draft);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  const fetchSources = useCallback(async () => {
    setSourcesLoading(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/sources`);
      if (res.ok) {
        const json = await res.json();
        const mapped: ProjectSource[] = json.map(
          (s: { id: string; fileName: string }) => ({
            id: s.id,
            fileName: s.fileName,
          }),
        );
        setSources(mapped);
        setSelectedSourceId((prev) => {
          if (prev && mapped.some((s) => s.id === prev)) return prev;
          return mapped[0]?.id ?? "";
        });
      }
    } catch {
      // Non-critical; extraction button simply won't show
    } finally {
      setSourcesLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    fetchSources();
  }, [fetchSources, sourcesVersion]);

  const handleSave = async () => {
    if (!draftContent) return;
    setSaving(true);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/editorial-briefs/${draftContent.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            content: draftContent.content,
            contracts: draftContent.contracts,
            evidenceSourceIds: draftContent.evidenceSourceIds,
          }),
        },
      );
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || `Save failed (${res.status})`);
      }
      const updated = await res.json();
      setDraftContent(updated);
      toast.success("Borrador guardado");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const handleApprove = async () => {
    if (!draftContent) return;
    setApproving(true);
    try {
      // Save first to preserve edits
      const saveRes = await fetch(
        `/api/projects/${projectId}/editorial-briefs/${draftContent.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            content: draftContent.content,
            contracts: draftContent.contracts,
            evidenceSourceIds: draftContent.evidenceSourceIds,
          }),
        },
      );
      if (!saveRes.ok) {
        const err = await saveRes.json();
        throw new Error(err.error || `Save failed (${saveRes.status})`);
      }
      // Now approve
      const approveRes = await fetch(
        `/api/projects/${projectId}/editorial-briefs/${draftContent.id}/approve`,
        { method: "POST" },
      );
      if (!approveRes.ok) {
        const err = await approveRes.json();
        throw new Error(err.error || `Approval failed (${approveRes.status})`);
      }
      toast.success("Brief guardado y aprobado");
      setShowApproveConfirm(false);
      await fetchData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to approve");
    } finally {
      setApproving(false);
    }
  };

  const handleCreateDraft = async (baseBriefId?: string) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/editorial-briefs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(baseBriefId ? { baseBriefId } : {}),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || `Create failed (${res.status})`);
      }
      toast.success("Borrador creado");
      setShowNewVersion(false);
      await fetchData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create draft");
    } finally {
      setSaving(false);
    }
  };

  const handleExtractDraft = async (sourceId: string) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/editorial-briefs/extract`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceId }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || `Extraction failed (${res.status})`);
      }
      toast.success("Brief extraído del documento de investigación");
      await fetchData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to extract");
    } finally {
      setSaving(false);
    }
  };

  const handleUploadSource = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    const fileInput = uploadFileRef.current;
    if (!fileInput?.files?.length) {
      toast.error("Selecciona un archivo primero");
      return;
    }

    const file = fileInput.files[0];
    if (!file) return;

    const ext = file.name.split(".").pop()?.toLowerCase();
    if (ext !== "md" && ext !== "txt") {
      toast.error("Solo se permiten archivos .md y .txt");
      return;
    }

    setUploadingSource(true);
    try {
      const formData = new FormData();
      formData.set("file", file);
      formData.set("sourceKind", uploadSourceKind);

      const res = await fetch(`/api/projects/${projectId}/sources`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Error al subir (${res.status})`);
      }

      const created = await res.json();
      toast.success(`"${created.fileName}" subido (${created.chunkCount} chunks)`);

      // Reset form
      if (uploadFileRef.current) uploadFileRef.current.value = "";
      setUploadSourceKind("reference");

      // Refresh source selector
      await fetchSources();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al subir archivo");
    } finally {
      setUploadingSource(false);
    }
  };

  const handleDeleteDraft = async () => {
    if (!draftContent) return;
    setDeletingDraft(true);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/editorial-briefs/${draftContent.id}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `Error al eliminar (${res.status})`);
      }
      toast.success("Borrador eliminado");
      setShowDeleteConfirm(false);
      await fetchData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al eliminar borrador");
    } finally {
      setDeletingDraft(false);
    }
  };

  const updateContent = useCallback(
    (updater: (prev: EditorialBundle) => EditorialBundle) => {
      setDraftContent((prev) => (prev ? updater(prev) : null));
    },
    [],
  );

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          <p>{error}</p>
          <Button variant="outline" className="mt-4" onClick={fetchData}>
            Reintentar
          </Button>
        </CardContent>
      </Card>
    );
  }

  const active = data?.active;
  const draft = draftContent;
  const history = data?.history ?? [];

  const sourcesSection = (
    <>
      {/* Upload source */}
      <div className="border rounded-lg p-4 space-y-3">
        <h4 className="text-sm font-medium flex items-center gap-2">
          <Upload className="h-4 w-4" />
          Subir documento
        </h4>
        <form onSubmit={handleUploadSource} className="space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1">Archivo</label>
            <input
              ref={uploadFileRef}
              type="file"
              accept=".md,.txt"
              className="block w-full text-sm text-muted-foreground
                file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0
                file:text-sm file:font-medium file:bg-primary file:text-primary-foreground
                hover:file:bg-primary/90 file:cursor-pointer"
            />
            <p className="text-xs text-muted-foreground mt-1">
              .md o .txt
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Tipo</label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="uploadSourceKind"
                  value="reference"
                  checked={uploadSourceKind === "reference"}
                  onChange={() => setUploadSourceKind("reference")}
                  className="text-primary"
                />
                <span className="text-sm">Bibliografía</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="uploadSourceKind"
                  value="example"
                  checked={uploadSourceKind === "example"}
                  onChange={() => setUploadSourceKind("example")}
                  className="text-primary"
                />
                <span className="text-sm">Ejemplos</span>
              </label>
            </div>
          </div>
          <Button type="submit" disabled={uploadingSource} size="sm">
            {uploadingSource ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Subiendo...
              </>
            ) : (
              "Subir"
            )}
          </Button>
        </form>
      </div>

      {sources.length > 0 && (
        <div className="flex items-end gap-2">
          <div className="flex-1 space-y-1">
            <Label className="text-xs">Fuente de investigación</Label>
            <Select
              value={selectedSourceId}
              onValueChange={setSelectedSourceId}
            >
              <SelectTrigger>
                <SelectValue placeholder="Seleccionar fuente..." />
              </SelectTrigger>
              <SelectContent>
                {sources.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.fileName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            variant="default"
            onClick={() => handleExtractDraft(selectedSourceId)}
            disabled={saving || !selectedSourceId}
          >
            Extraer borrador
          </Button>
        </div>
      )}
      {sourcesLoading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Cargando fuentes...
        </div>
      )}
      <div className="flex gap-2">
        <Button
          variant="outline"
          onClick={() => handleCreateDraft()}
          disabled={saving}
        >
          <Plus className="h-4 w-4 mr-2" />
          Crear borrador vacío
        </Button>
      </div>
    </>
  );

  // No brief at all
  if (!active && !draft) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Brief Editorial
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <p className="text-sm text-muted-foreground">
            No hay brief editorial. Sube un documento de investigación como fuente
            y extráelo, o crea un borrador vacío.
          </p>
          {sourcesSection}
        </CardContent>
      </Card>
    );
  }

  const hashPrefix = (hash: string) => hash.substring(0, 8);

  return (
    <div className="space-y-6">
      {/* Active approved brief */}
      {active && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-green-500" />
              Brief Aprobado
              <Badge variant="secondary">v{active.version}</Badge>
            </CardTitle>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowNewVersion(true)}
            >
              <Plus className="h-4 w-4 mr-2" />
              Nueva versión
            </Button>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Hash: {hashPrefix(active.hash)}… · {active.contracts.length} contratos de capítulo
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              La nueva versión clonará este brief y lo abrirá como borrador editable.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Draft editor */}
      {draft && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Borrador
              <Badge>v{draft.version}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Global content form */}
            {isEditorialBriefContentV3(draft.content) ? (
              <p className="text-sm text-muted-foreground border rounded-md p-4">
                El formato v3 del brief no es editable en esta versión del editor.
              </p>
            ) : (
              <EditorialBriefForm
                content={draft.content}
                onChange={(content) =>
                  updateContent((prev) => ({ ...prev, content }))
                }
              />
            )}

            {/* Chapter contracts */}
            <div>
              <h3 className="text-lg font-semibold mb-4">
                Contratos de capítulo
              </h3>
              <div className="space-y-4">
                {draft.contracts.map((contract, i) => (
                  <ChapterContractEditor
                    key={contract.chapterId}
                    contract={contract}
                    chapterTitle={`Capítulo ${i + 1}`}
                    onChange={(updated) =>
                      updateContent((prev) => ({
                        ...prev,
                        contracts: prev.contracts.map((c) =>
                          c.chapterId === updated.chapterId ? updated : c,
                        ),
                      }))
                    }
                  />
                ))}
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-2 pt-4 border-t">
              <Button onClick={handleSave} disabled={saving || approving || deletingDraft}>
                {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Guardar borrador
              </Button>
              <Button
                variant="default"
                onClick={() => setShowApproveConfirm(true)}
                disabled={saving || approving || deletingDraft}
              >
                {approving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Aprobar
              </Button>
              <Button
                variant="destructive"
                onClick={() => setShowDeleteConfirm(true)}
                disabled={saving || approving || deletingDraft}
              >
                {deletingDraft && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Eliminar borrador
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Source uploader — available when brief exists */}
      {(active || draft) && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5" />
              Fuentes
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <p className="text-sm text-muted-foreground">
              Sube un documento de investigación y extráelo como borrador, o crea
              un borrador vacío para reemplazar el actual.
            </p>
            {sourcesSection}
          </CardContent>
        </Card>
      )}

      {/* Version history */}
      {history.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <History className="h-5 w-5" />
              Historial de versiones
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {history.map((h) => (
                <div
                  key={h.id}
                  className="flex items-center justify-between py-2 border-b last:border-0 text-sm"
                >
                  <div className="flex items-center gap-2">
                    <Badge
                      variant={
                        h.status === "approved"
                          ? "default"
                          : h.status === "draft"
                            ? "secondary"
                            : "outline"
                      }
                    >
                      {h.status === "approved"
                        ? "Aprobado"
                        : h.status === "draft"
                          ? "Borrador"
                          : "Archivado"}
                    </Badge>
                    <span>v{h.version}</span>
                    <span className="text-muted-foreground font-mono text-xs">
                      {hashPrefix(h.contentHash)}…
                    </span>
                  </div>
                  <div className="text-muted-foreground text-xs">
                    {new Date(h.createdAt).toLocaleDateString("es-CL", {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                    })}
                    {h.approvedAt &&
                      ` · Aprobado ${new Date(h.approvedAt).toLocaleDateString("es-CL", {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      })}`}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Approve confirmation */}
      <ConfirmDialog
        open={showApproveConfirm}
        onOpenChange={setShowApproveConfirm}
        onConfirm={handleApprove}
        title="Aprobar brief editorial"
        description="Al aprobar, este brief se usará en todas las generaciones futuras. La versión actual aprobada (si existe) será archivada."
        confirmLabel="Aprobar"
        variant="default"
        pending={approving}
        disabled={approving}
      />

      {/* Delete draft confirmation */}
      <ConfirmDialog
        open={showDeleteConfirm}
        onOpenChange={setShowDeleteConfirm}
        onConfirm={handleDeleteDraft}
        title="Eliminar borrador"
        description="El borrador se eliminará permanentemente. Las fuentes de investigación no se verán afectadas. Podrás crear un nuevo borrador o extraer uno desde una fuente."
        confirmLabel="Eliminar"
        variant="destructive"
        pending={deletingDraft}
        disabled={deletingDraft}
      />

      {/* New version confirmation */}
      <ConfirmDialog
        open={showNewVersion}
        onOpenChange={setShowNewVersion}
        onConfirm={() => {
          if (active) handleCreateDraft(active.id);
        }}
        title="Nueva versión del brief"
        description="Se creará un nuevo borrador a partir de la versión aprobada actual. Podrás editarlo y aprobarlo como una nueva versión."
        confirmLabel="Crear"
        variant="default"
      />
    </div>
  );
}
