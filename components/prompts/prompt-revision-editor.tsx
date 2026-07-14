"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Plus, GitCompare, AlertTriangle, History } from "lucide-react";
import { toast } from "sonner";
import { assertPromptMarkers, requiredMarkersByKind } from "@/lib/prompts/contracts";
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
}

export interface PromptRevisionEditorProps {
  definitionId: string;
  definitionName: string;
  kind: PromptKind;
  revisions: RevisionSummary[];
  onRevisionCreated(): void;
}

export function PromptRevisionEditor({
  definitionId,
  definitionName,
  kind,
  revisions,
  onRevisionCreated,
}: PromptRevisionEditorProps) {
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [versionLabel, setVersionLabel] = useState("");
  const [systemTemplate, setSystemTemplate] = useState("");
  const [userTemplate, setUserTemplate] = useState("");
  const [outputContract, setOutputContract] = useState("");
  const [compareLeft, setCompareLeft] = useState<string | null>(null);
  const [compareRight, setCompareRight] = useState<string | null>(null);
  const [showCompare, setShowCompare] = useState(false);

  const requiredMarkers = requiredMarkersByKind[kind] ?? [];

  function validateMarkers(): string | null {
    try {
      assertPromptMarkers(kind, systemTemplate, userTemplate);
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : "Invalid markers";
    }
  }

  async function createRevision() {
    if (!versionLabel.trim()) return;
    setCreating(true);
    const res = await fetch(`/api/prompt-definitions/${definitionId}/revisions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        versionLabel: versionLabel.trim(),
        systemTemplate,
        userTemplate,
        outputContract: outputContract.trim() || null,
        configuration: {},
      }),
    });
    if (res.ok) {
      setCreateOpen(false);
      setVersionLabel("");
      setSystemTemplate("");
      setUserTemplate("");
      setOutputContract("");
      onRevisionCreated();
      toast.success("Revisión creada");
    } else {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error ?? "Error al crear revisión");
    }
    setCreating(false);
  }

  function initFromLatest() {
    const latest = revisions[0];
    if (latest) {
      setVersionLabel("");
      setSystemTemplate(latest.systemTemplate);
      setUserTemplate(latest.userTemplate);
      setOutputContract(latest.outputContract ?? "");
    }
  }

  const leftRev = compareLeft ? revisions.find((r) => r.id === compareLeft) : null;
  const rightRev = compareRight ? revisions.find((r) => r.id === compareRight) : null;

  const markerError = systemTemplate || userTemplate ? validateMarkers() : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <History className="h-5 w-5" />
          Revisiones
        </h3>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button size="sm" onClick={initFromLatest}>
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

              <Button
                onClick={createRevision}
                disabled={creating || !versionLabel.trim() || !!markerError}
                className="w-full"
              >
                {creating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Crear revisión inmutable
              </Button>
            </div>
          </DialogContent>
        </Dialog>
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
            return (
              <Card
                key={rev.id}
                className={`cursor-pointer transition-colors ${
                  isSelected ? "ring-2 ring-brand-500" : "hover:bg-muted/50"
                }`}
                onClick={() => {
                  if (!compareLeft) setCompareLeft(rev.id);
                  else if (!compareRight && rev.id !== compareLeft) {
                    setCompareRight(rev.id);
                    setShowCompare(true);
                  } else {
                    setCompareLeft(rev.id);
                    setCompareRight(null);
                    setShowCompare(false);
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
    </div>
  );
}
