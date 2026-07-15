"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus, GitCompare, AlertTriangle, History, Eye, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { assertPromptMarkers, requiredMarkersByKind } from "@/lib/prompts/contracts";
import { RevisionDiff } from "@/components/prompts/revision-diff";
import { KIND_LABELS } from "@/lib/prompts/kinds";
import type { PromptKind } from "@/lib/db/schema/prompt-registry";

export interface RevisionSummary {
  id: string;
  revisionNumber: number;
  versionLabel: string;
  systemTemplate: string;
  userTemplate: string;
  requiredMarkers: string[];
  outputContract: string | null;
  configuration: Record<string, unknown>;
  createdAt: string;
  createdBy: string | null;
  isDefault: boolean;
  bindingCount: number;
  executionCount: number;
}

export interface PromptRevisionEditorProps {
  definitionId: string;
  definitionName: string;
  kind: PromptKind;
  archived: boolean;
  currentDefaultRevisionId?: string | null;
  revisions: RevisionSummary[];
  onChanged(): void;
}

export function PromptRevisionEditor({
  definitionId,
  definitionName,
  kind,
  archived,
  currentDefaultRevisionId,
  revisions,
  onChanged,
}: PromptRevisionEditorProps) {
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [baseRevisionId, setBaseRevisionId] = useState<string | null>(null);
  const [versionLabel, setVersionLabel] = useState("");
  const [systemTemplate, setSystemTemplate] = useState("");
  const [userTemplate, setUserTemplate] = useState("");
  const [outputContract, setOutputContract] = useState("");
  const [configurationJson, setConfigurationJson] = useState("{}");
  const [compareLeft, setCompareLeft] = useState<string | null>(null);
  const [compareRight, setCompareRight] = useState<string | null>(null);
  const [showCompare, setShowCompare] = useState(false);
  const [confirmDefaultRevId, setConfirmDefaultRevId] = useState<string | null>(null);
  const [detailRevId, setDetailRevId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [compareMode, setCompareMode] = useState(false);

  const requiredMarkers = requiredMarkersByKind[kind] ?? [];
  const baseRevision = baseRevisionId
    ? revisions.find((r) => r.id === baseRevisionId)
    : null;

  function validateMarkers(): string | null {
    try {
      assertPromptMarkers(kind, systemTemplate, userTemplate);
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : "Invalid markers";
    }
  }

  function parseConfiguration(): Record<string, unknown> | null {
    try {
      const parsed: unknown = JSON.parse(configurationJson);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }

  const configValid = parseConfiguration() !== null;
  const markerError = systemTemplate || userTemplate ? validateMarkers() : null;
  const canSave =
    versionLabel.trim() && !markerError && configValid;

  function openFromRevision(base: RevisionSummary | null) {
    setBaseRevisionId(base?.id ?? null);
    if (base) {
      setVersionLabel("");
      setSystemTemplate(base.systemTemplate);
      setUserTemplate(base.userTemplate);
      setOutputContract(base.outputContract ?? "");
      setConfigurationJson(
        JSON.stringify(base.configuration ?? {}, null, 2),
      );
    } else {
      setVersionLabel("");
      setSystemTemplate("");
      setUserTemplate("");
      setOutputContract("");
      setConfigurationJson("{}");
    }
  }

  async function createRevision() {
    if (!canSave) return;
    setCreating(true);
    const res = await fetch(`/api/prompt-definitions/${definitionId}/revisions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        versionLabel: versionLabel.trim(),
        systemTemplate,
        userTemplate,
        outputContract: outputContract.trim() || null,
        configuration: parseConfiguration() ?? {},
      }),
    });
    if (res.ok) {
      setCreateOpen(false);
      setBaseRevisionId(null);
      setVersionLabel("");
      setSystemTemplate("");
      setUserTemplate("");
      setOutputContract("");
      setConfigurationJson("{}");
      onChanged();
      toast.success("Revisión creada");
    } else {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error ?? "Error al crear revisión");
    }
    setCreating(false);
  }

  async function setDefault(revisionId: string) {
    const res = await fetch(`/api/prompt-defaults/${kind}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ promptRevisionId: revisionId }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(body.error ?? "No se pudo cambiar el default");
      return;
    }
    toast.success("Default actualizado");
    onChanged();
  }

  async function deleteRevision(revisionId: string) {
    setDeleting(true);
    const res = await fetch(
      `/api/prompt-definitions/${definitionId}/revisions/${revisionId}`,
      { method: "DELETE" },
    );
    if (res.ok) {
      setDetailRevId(null);
      onChanged();
      toast.success("Revisión eliminada");
    } else {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error ?? "Error al eliminar revisión");
    }
    setDeleting(false);
  }

  const leftRev = compareLeft ? revisions.find((r) => r.id === compareLeft) : null;
  const rightRev = compareRight ? revisions.find((r) => r.id === compareRight) : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <History className="h-5 w-5" />
          Revisiones
        </h3>
        {!archived && (
          <div className="flex items-center gap-2">
            <Button
              variant={compareMode ? "secondary" : "outline"}
              size="sm"
              onClick={() => {
                setCompareMode(!compareMode);
                setCompareLeft(null);
                setCompareRight(null);
                setShowCompare(false);
              }}
            >
              <GitCompare className="h-4 w-4 mr-1" />
              {compareMode ? "Cancelar comparación" : "Comparar"}
            </Button>
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button size="sm" onClick={() => openFromRevision(null)}>
                <Plus className="h-4 w-4 mr-1" />Crear revisión
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Nueva revisión — {definitionName}</DialogTitle>
                <DialogDescription>
                  Las revisiones son inmutables. Cada cambio crea una nueva revisión.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label htmlFor="ver">Versión</Label>
                  <Input
                    id="ver"
                    value={versionLabel}
                    onChange={(e) => setVersionLabel(e.target.value)}
                    placeholder="1.0"
                  />
                </div>

                <div>
                  <Label htmlFor="sys">System Template</Label>
                  <Textarea
                    id="sys"
                    value={systemTemplate}
                    onChange={(e) => setSystemTemplate(e.target.value)}
                    className="font-mono text-xs min-h-[200px]"
                    placeholder="Eres un escritor..."
                  />
                </div>

                <div>
                  <Label htmlFor="usr">User Template</Label>
                  <Textarea
                    id="usr"
                    value={userTemplate}
                    onChange={(e) => setUserTemplate(e.target.value)}
                    className="font-mono text-xs min-h-[150px]"
                    placeholder="{{EDITORIAL_CONTEXT}} {{ASSEMBLY_PLAN}}..."
                  />
                </div>

                <div>
                  <Label htmlFor="oc">Output Contract (opcional)</Label>
                  <Input
                    id="oc"
                    value={outputContract}
                    onChange={(e) => setOutputContract(e.target.value)}
                    placeholder="assembly-plan-v1"
                  />
                </div>

                <div>
                  <Label htmlFor="cfg">Configuración JSON</Label>
                  <Textarea
                    id="cfg"
                    value={configurationJson}
                    onChange={(e) => setConfigurationJson(e.target.value)}
                    className="font-mono text-xs min-h-[100px]"
                    placeholder='{"temperature": 0}'
                  />
                  {!configValid && configurationJson.trim() && (
                    <p className="text-xs text-destructive mt-1">JSON inválido</p>
                  )}
                </div>

                <div>
                  <Label>Markers requeridos</Label>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {requiredMarkers.map((m) => (
                      <code key={m} className="text-[10px] bg-muted px-1.5 py-0.5 rounded">
                        {m}
                      </code>
                    ))}
                  </div>
                </div>

                {markerError && (
                  <div className="flex items-center gap-2 text-sm text-destructive">
                    <AlertTriangle className="h-4 w-4" />
                    {markerError}
                  </div>
                )}

                {baseRevision && (
                  <div className="space-y-2">
                    <Label>Cambios desde v{baseRevision.versionLabel}</Label>
                    <RevisionDiff
                      before={`${baseRevision.systemTemplate}\n\n---\n\n${baseRevision.userTemplate}`}
                      after={`${systemTemplate}\n\n---\n\n${userTemplate}`}
                    />
                  </div>
                )}

                <Button
                  onClick={createRevision}
                  disabled={creating || !canSave}
                  className="w-full"
                >
                  {creating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Crear revisión inmutable
                </Button>
              </div>
            </DialogContent>
          </Dialog>
          </div>
        )}
      </div>

      {/* Revisions list */}
      {revisions.length === 0 ? (
        <p className="text-sm text-muted-foreground">Sin revisiones aún.</p>
      ) : (
        <div className="space-y-2">
          {revisions.map((rev) => {
            const isLegacy = rev.configuration?.legacyNonExecutable === true;
            const isSelected =
              compareLeft === rev.id || compareRight === rev.id;
            const isCurrentDefault = rev.id === currentDefaultRevisionId;
            return (
              <Card
                key={rev.id}
                className={`cursor-pointer transition-colors ${
                  isSelected ? "ring-2 ring-brand-500" : "hover:bg-muted/50"
                }`}
                onClick={() => {
                  if (compareMode) {
                    if (!compareLeft) setCompareLeft(rev.id);
                    else if (!compareRight && rev.id !== compareLeft) {
                      setCompareRight(rev.id);
                      setShowCompare(true);
                    } else {
                      setCompareLeft(rev.id);
                      setCompareRight(null);
                      setShowCompare(false);
                    }
                  } else {
                    setDetailRevId(rev.id);
                  }
                }}
              >
                <CardHeader className="py-2 px-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                      v{rev.versionLabel}
                      <span className="text-xs text-muted-foreground font-normal">
                        (#{rev.revisionNumber})
                      </span>
                      {isLegacy && (
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300">
                          Histórica — no ejecutable
                        </span>
                      )}
                      {isCurrentDefault && (
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-auto">
                          Default
                        </Badge>
                      )}
                    </CardTitle>
                    <span className="text-xs text-muted-foreground">
                      {rev.createdAt.slice(0, 10)}
                    </span>
                  </div>
                </CardHeader>
                <CardContent className="py-1 px-3">
                  <div className="text-xs text-muted-foreground line-clamp-2 font-mono">
                    {rev.systemTemplate.slice(0, 200)}
                  </div>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    {rev.executionCount > 0 && (
                      <span className="text-[10px] text-muted-foreground">
                        {rev.executionCount} ejec.
                      </span>
                    )}
                    {rev.bindingCount > 0 && (
                      <span className="text-[10px] text-muted-foreground">
                        {rev.bindingCount} proyectos
                      </span>
                    )}
                    {!archived && !isLegacy && (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 text-[10px] px-1.5"
                          onClick={(e) => {
                            e.stopPropagation();
                            openFromRevision(rev);
                            setCreateOpen(true);
                          }}
                        >
                          Crear desde v{rev.versionLabel}
                        </Button>
                        {!isCurrentDefault && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 text-[10px] px-1.5"
                            onClick={(e) => {
                              e.stopPropagation();
                              setConfirmDefaultRevId(rev.id);
                            }}
                          >
                            Set default
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Compare dialog */}
      <Dialog open={showCompare} onOpenChange={setShowCompare}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <GitCompare className="h-5 w-5" />
              Comparar revisiones
            </DialogTitle>
            <DialogDescription>
              {leftRev ? `v${leftRev.versionLabel}` : "—"} vs{" "}
              {rightRev ? `v${rightRev.versionLabel}` : "—"}
            </DialogDescription>
          </DialogHeader>
          {leftRev && rightRev ? (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <h4 className="font-medium text-sm mb-1">v{leftRev.versionLabel}</h4>
                <pre className="text-xs bg-muted p-2 rounded whitespace-pre-wrap max-h-96 overflow-y-auto">
                  {leftRev.systemTemplate}
                  {"\n\n---\n\n"}
                  {leftRev.userTemplate}
                </pre>
              </div>
              <div>
                <h4 className="font-medium text-sm mb-1">v{rightRev.versionLabel}</h4>
                <pre className="text-xs bg-muted p-2 rounded whitespace-pre-wrap max-h-96 overflow-y-auto">
                  {rightRev.systemTemplate}
                  {"\n\n---\n\n"}
                  {rightRev.userTemplate}
                </pre>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Selecciona dos revisiones para comparar.
            </p>
          )}
          <div className="flex justify-end gap-2 mt-2">
            <Button
              variant="outline"
              onClick={() => {
                setCompareLeft(null);
                setCompareRight(null);
                setShowCompare(false);
              }}
            >
              Cerrar
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Detail dialog */}
      <Dialog
        open={detailRevId !== null}
        onOpenChange={(open) => {
          if (!open) setDetailRevId(null);
        }}
      >
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          {(() => {
            const rev = revisions.find((r) => r.id === detailRevId);
            if (!rev) return null;
            const isLegacy = rev.configuration?.legacyNonExecutable === true;
            const isCurrentDefault = rev.id === currentDefaultRevisionId;
            return (
              <div className="space-y-4">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <Eye className="h-5 w-5" />
                    v{rev.versionLabel}
                    <span className="text-sm text-muted-foreground font-normal">
                      (#{rev.revisionNumber})
                    </span>
                    {isCurrentDefault && (
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-auto">
                        Default
                      </Badge>
                    )}
                    {isLegacy && (
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300">
                        Histórica — no ejecutable
                      </span>
                    )}
                  </DialogTitle>
                  <DialogDescription>
                    Creada el {rev.createdAt.slice(0, 10)}
                    {rev.executionCount > 0 && ` · ${rev.executionCount} ejecuciones`}
                    {rev.bindingCount > 0 && ` · ${rev.bindingCount} proyectos`}
                  </DialogDescription>
                </DialogHeader>

                <div>
                  <Label className="text-xs text-muted-foreground">System Template</Label>
                  <pre className="text-xs bg-muted p-3 rounded whitespace-pre-wrap max-h-60 overflow-y-auto mt-1 font-mono">
                    {rev.systemTemplate}
                  </pre>
                </div>

                <div>
                  <Label className="text-xs text-muted-foreground">User Template</Label>
                  <pre className="text-xs bg-muted p-3 rounded whitespace-pre-wrap max-h-60 overflow-y-auto mt-1 font-mono">
                    {rev.userTemplate}
                  </pre>
                </div>

                {rev.requiredMarkers.length > 0 && (
                  <div>
                    <Label className="text-xs text-muted-foreground">Markers requeridos</Label>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {rev.requiredMarkers.map((m) => (
                        <code key={m} className="text-[10px] bg-muted px-1.5 py-0.5 rounded">
                          {m}
                        </code>
                      ))}
                    </div>
                  </div>
                )}

                {rev.outputContract && (
                  <div>
                    <Label className="text-xs text-muted-foreground">Output Contract</Label>
                    <p className="text-sm font-mono mt-1">{rev.outputContract}</p>
                  </div>
                )}

                <div>
                  <Label className="text-xs text-muted-foreground">Configuración</Label>
                  <pre className="text-xs bg-muted p-2 rounded mt-1 font-mono max-h-40 overflow-y-auto">
                    {JSON.stringify(rev.configuration, null, 2)}
                  </pre>
                </div>

                <div className="flex items-center justify-between pt-2 border-t">
                  <div className="flex gap-2">
                    {!archived && !isLegacy && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          openFromRevision(rev);
                          setDetailRevId(null);
                          setCreateOpen(true);
                        }}
                      >
                        <Plus className="h-4 w-4 mr-1" />
                        Crear desde v{rev.versionLabel}
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setDetailRevId(null);
                        setCompareMode(true);
                        setCompareLeft(rev.id);
                        setCompareRight(null);
                        setShowCompare(false);
                      }}
                    >
                      <GitCompare className="h-4 w-4 mr-1" />
                      Comparar
                    </Button>
                  </div>
                  {!archived && !isCurrentDefault && rev.bindingCount === 0 && (
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={deleting}
                      onClick={() => {
                        if (deleting) return;
                        deleteRevision(rev.id);
                      }}
                    >
                      {deleting ? (
                        <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4 mr-1" />
                      )}
                      Eliminar
                    </Button>
                  )}
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* Confirm set-default dialog */}
      <Dialog
        open={confirmDefaultRevId !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmDefaultRevId(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>¿Cambiar default global?</DialogTitle>
            <DialogDescription>
              Esta revisión se usará como prompt por defecto para{" "}
              <strong>{KIND_LABELS[kind]}</strong> en todos los proyectos sin
              binding propio. Esta acción afecta a ejecuciones futuras.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setConfirmDefaultRevId(null)}>
              Cancelar
            </Button>
            <Button
              onClick={() => {
                if (confirmDefaultRevId) {
                  setDefault(confirmDefaultRevId);
                  setConfirmDefaultRevId(null);
                }
              }}
            >
              Cambiar default
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
