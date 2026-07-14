"use client";

import { useState, useEffect } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { EditorialBriefContent } from "@/lib/editorial-brief/schema";

// ---------------------------------------------------------------------------
// EditorialBriefForm
// ---------------------------------------------------------------------------

interface EditorialBriefFormProps {
  content: EditorialBriefContent;
  onChange: (content: EditorialBriefContent) => void;
}

/**
 * Form that edits the global EditorialBriefContent. Each string[] field is a
 * textarea (one item per line); each string field is an Input.
 */
export function EditorialBriefForm({ content, onChange }: EditorialBriefFormProps) {
  return (
    <div className="space-y-8">
      {/* Market */}
      <section>
        <h3 className="text-lg font-semibold mb-4">Mercado</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label htmlFor="region">Región</Label>
            <Input
              id="region"
              className="text-sm"
              value={content.market.region}
              onChange={(e) =>
                onChange({
                  ...content,
                  market: { ...content.market, region: e.target.value },
                })
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="researchLanguage">Idioma de investigación</Label>
            <Input
              id="researchLanguage"
              className="text-sm"
              value={content.market.researchLanguage}
              onChange={(e) =>
                onChange({
                  ...content,
                  market: { ...content.market, researchLanguage: e.target.value },
                })
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="manuscriptLanguage">Idioma del manuscrito</Label>
            <Input
              id="manuscriptLanguage"
              className="text-sm"
              value={content.market.manuscriptLanguage}
              onChange={(e) =>
                onChange({
                  ...content,
                  market: { ...content.market, manuscriptLanguage: e.target.value },
                })
              }
            />
          </div>
        </div>
      </section>

      {/* Audience */}
      <section>
        <h3 className="text-lg font-semibold mb-4">Audiencia</h3>
        <div className="space-y-4">
          <FieldInput
            label="Lector primario"
            value={content.audience.primaryReader}
            onChange={(v) =>
              onChange({
                ...content,
                audience: { ...content.audience, primaryReader: v },
              })
            }
          />
          <FieldInput
            label="Situación"
            value={content.audience.situation}
            onChange={(v) =>
              onChange({
                ...content,
                audience: { ...content.audience, situation: v },
              })
            }
          />
          <FieldInput
            label="Dolor"
            value={content.audience.pain}
            onChange={(v) =>
              onChange({
                ...content,
                audience: { ...content.audience, pain: v },
              })
            }
          />
          <FieldInput
            label="Conciencia"
            value={content.audience.awareness}
            onChange={(v) =>
              onChange({
                ...content,
                audience: { ...content.audience, awareness: v },
              })
            }
          />
          <FieldTextareaArray
            label="Objeciones (una por línea)"
            value={content.audience.objections}
            onChange={(v) =>
              onChange({
                ...content,
                audience: { ...content.audience, objections: v },
              })
            }
          />
        </div>
      </section>

      {/* Thesis */}
      <section>
        <h3 className="text-lg font-semibold mb-4">Tesis</h3>
        <div className="space-y-4">
          <FieldInput
            label="Problema central"
            value={content.thesis.coreProblem}
            onChange={(v) =>
              onChange({
                ...content,
                thesis: { ...content.thesis, coreProblem: v },
              })
            }
          />
          <FieldInput
            label="Resultado deseado"
            value={content.thesis.desiredOutcome}
            onChange={(v) =>
              onChange({
                ...content,
                thesis: { ...content.thesis, desiredOutcome: v },
              })
            }
          />
          <FieldInput
            label="Promesa"
            value={content.thesis.promise}
            onChange={(v) =>
              onChange({
                ...content,
                thesis: { ...content.thesis, promise: v },
              })
            }
          />
          <FieldTextareaArray
            label="Mecanismos (uno por línea)"
            value={content.thesis.mechanism}
            onChange={(v) =>
              onChange({
                ...content,
                thesis: { ...content.thesis, mechanism: v },
              })
            }
          />
          <FieldInput
            label="Límite realista"
            value={content.thesis.realisticBoundary}
            onChange={(v) =>
              onChange({
                ...content,
                thesis: { ...content.thesis, realisticBoundary: v },
              })
            }
          />
        </div>
      </section>

      {/* Voice */}
      <section>
        <h3 className="text-lg font-semibold mb-4">Voz</h3>
        <div className="space-y-4">
          <FieldTextareaArray
            label="Tono (uno por línea)"
            value={content.voice.tone}
            onChange={(v) =>
              onChange({
                ...content,
                voice: { ...content.voice, tone: v },
              })
            }
          />
          <FieldInput
            label="Postura"
            value={content.voice.posture}
            onChange={(v) =>
              onChange({
                ...content,
                voice: { ...content.voice, posture: v },
              })
            }
          />
          <FieldInput
            label="Nivel de lectura"
            value={content.voice.readingLevel}
            onChange={(v) =>
              onChange({
                ...content,
                voice: { ...content.voice, readingLevel: v },
              })
            }
          />
          <FieldTextareaArray
            label="Evitar (uno por línea)"
            value={content.voice.avoid}
            onChange={(v) =>
              onChange({
                ...content,
                voice: { ...content.voice, avoid: v },
              })
            }
          />
        </div>
      </section>

      {/* Content Strategy */}
      <section>
        <h3 className="text-lg font-semibold mb-4">Estrategia de contenido</h3>
        <div className="space-y-4">
          <FieldTextareaArray
            label="Pilares (uno por línea)"
            value={content.contentStrategy.pillars}
            onChange={(v) =>
              onChange({
                ...content,
                contentStrategy: { ...content.contentStrategy, pillars: v },
              })
            }
          />
          <FieldTextareaArray
            label="Escenarios requeridos (uno por línea)"
            value={content.contentStrategy.requiredScenarios}
            onChange={(v) =>
              onChange({
                ...content,
                contentStrategy: { ...content.contentStrategy, requiredScenarios: v },
              })
            }
          />
          <FieldTextareaArray
            label="Patrón recurrente (uno por línea)"
            value={content.contentStrategy.recurringPattern}
            onChange={(v) =>
              onChange({
                ...content,
                contentStrategy: { ...content.contentStrategy, recurringPattern: v },
              })
            }
          />
          <FieldInput
            label="Política de ejemplos"
            value={content.contentStrategy.examplePolicy}
            onChange={(v) =>
              onChange({
                ...content,
                contentStrategy: { ...content.contentStrategy, examplePolicy: v },
              })
            }
          />
        </div>
      </section>

      {/* Guardrails */}
      <section>
        <h3 className="text-lg font-semibold mb-4">Guardarraíles</h3>
        <div className="space-y-4">
          <FieldTextareaArray
            label="Principios éticos (uno por línea)"
            value={content.guardrails.ethicalPrinciples}
            onChange={(v) =>
              onChange({
                ...content,
                guardrails: { ...content.guardrails, ethicalPrinciples: v },
              })
            }
          />
          <FieldTextareaArray
            label="Afirmaciones prohibidas (una por línea)"
            value={content.guardrails.forbiddenClaims}
            onChange={(v) =>
              onChange({
                ...content,
                guardrails: { ...content.guardrails, forbiddenClaims: v },
              })
            }
          />
          <FieldTextareaArray
            label="Enfoques prohibidos (uno por línea)"
            value={content.guardrails.forbiddenFraming}
            onChange={(v) =>
              onChange({
                ...content,
                guardrails: { ...content.guardrails, forbiddenFraming: v },
              })
            }
          />
        </div>
      </section>

      {/* Evidence */}
      <section>
        <h3 className="text-lg font-semibold mb-4">Evidencia</h3>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="evidenceMode">Modo</Label>
            <select
              id="evidenceMode"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              value={content.evidence.mode}
              onChange={(e) =>
                onChange({
                  ...content,
                  evidence: { ...content.evidence, mode: e.target.value as "rag_optional" | "rag_required_for_named_needs" },
                })
              }
            >
              <option value="rag_optional">RAG opcional</option>
              <option value="rag_required_for_named_needs">RAG requerido para necesidades nombradas</option>
            </select>
          </div>
          <FieldInput
            label="Política de citación"
            value={content.evidence.citationPolicy}
            onChange={(v) =>
              onChange({
                ...content,
                evidence: { ...content.evidence, citationPolicy: v },
              })
            }
          />
        </div>
      </section>

      {/* Packaging */}
      <section>
        <h3 className="text-lg font-semibold mb-4">Empaquetado</h3>
        <div className="space-y-4">
          <FieldInput
            label="Ángulo del título"
            value={content.packaging.titleAngle}
            onChange={(v) =>
              onChange({
                ...content,
                packaging: { ...content.packaging, titleAngle: v },
              })
            }
          />
          <FieldInput
            label="Hook"
            value={content.packaging.hook}
            onChange={(v) =>
              onChange({
                ...content,
                packaging: { ...content.packaging, hook: v },
              })
            }
          />
          <FieldTextareaArray
            label="Términos SEO (uno por línea)"
            value={content.packaging.seoTerms}
            onChange={(v) =>
              onChange({
                ...content,
                packaging: { ...content.packaging, seoTerms: v },
              })
            }
          />
        </div>
      </section>

      {/* Research Basis */}
      <section>
        <h3 className="text-lg font-semibold mb-4">Base de investigación</h3>
        <div className="space-y-4">
          <FieldTextareaArray
            label="Hallazgos (uno por línea)"
            value={content.researchBasis.findings}
            onChange={(v) =>
              onChange({
                ...content,
                researchBasis: { ...content.researchBasis, findings: v },
              })
            }
          />
          <FieldTextareaArray
            label="Inferencias (una por línea)"
            value={content.researchBasis.inferences}
            onChange={(v) =>
              onChange({
                ...content,
                researchBasis: { ...content.researchBasis, inferences: v },
              })
            }
          />
          <FieldTextareaArray
            label="Limitaciones (una por línea)"
            value={content.researchBasis.limitations}
            onChange={(v) =>
              onChange({
                ...content,
                researchBasis: { ...content.researchBasis, limitations: v },
              })
            }
          />
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Internal field helpers
// ---------------------------------------------------------------------------

interface FieldInputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
}

function FieldInput({ label, value, onChange }: FieldInputProps) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Textarea
        className="text-sm min-h-[60px]"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

interface FieldTextareaArrayProps {
  label: string;
  value: string[];
  onChange: (value: string[]) => void;
}

function FieldTextareaArray({ label, value, onChange }: FieldTextareaArrayProps) {
  const [raw, setRaw] = useState(value.join("\n"));
  const joined = value.join("\n");

  useEffect(() => {
    setRaw(joined);
  }, [joined]);

  const handleBlur = () => {
    const lines = raw
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    onChange(lines.length === 0 ? ["-"] : lines);
  };

  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <textarea
        className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm"
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        onBlur={handleBlur}
      />
    </div>
  );
}
