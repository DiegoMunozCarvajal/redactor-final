import type { ExtractedBlock, ExtractedBlocks } from "./metadata-blocks";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type StageRating =
  | "respaldada"
  | "plausible"
  | "no_respaldada_con_evidencia_relevante"
  | "no_respaldada_sin_evidencia_relevante";

type StageMode = "desarrollar" | "hipotesis" | "limite" | "omitir";

export interface StageConfig {
  [stageName: string]: StageMode;
}

export interface FragmentWithMeta {
  id: string;
  title: string;
  content: string;
  position: number;
  extractedBlocks?: ExtractedBlocks;
}

export interface StageOmissionResult {
  fragments: FragmentWithMeta[];
  stageConfig: StageConfig;
  omissions: string[];
}

// ---------------------------------------------------------------------------
// deriveStageConfig
// ---------------------------------------------------------------------------

const RATING_TO_MODE: Record<string, StageMode> = {
  respaldada: "desarrollar",
  plausible: "hipotesis",
  no_respaldada_con_evidencia_relevante: "limite",
  no_respaldada_sin_evidencia_relevante: "omitir",
};

/**
 * Maps stage ratings from [ESTADO_ETAPAS] block to stage modes.
 *
 * Known ratings:
 *   respaldada                                 → desarrollar
 *   plausible                                  → hipotesis
 *   no_respaldada_con_evidencia_relevante      → limite
 *   no_respaldada_sin_evidencia_relevante      → omitir
 *
 * Unknown or unrecognized ratings default to "desarrollar".
 */
export function deriveStageConfig(estadoEtapas: ExtractedBlock): StageConfig {
  const config: StageConfig = {};

  for (const [stageName, rating] of Object.entries(estadoEtapas)) {
    config[stageName] = RATING_TO_MODE[rating] ?? "desarrollar";
  }

  return config;
}

// ---------------------------------------------------------------------------
// applyStageOmission
// ---------------------------------------------------------------------------

/**
 * Apply stage omission based on [ESTADO_ETAPAS] extracted from fragments.
 *
 * 1. Iterates fragments looking for one with `extractedBlocks?.ESTADO_ETAPAS`
 * 2. If not found, returns null (no omission to apply)
 * 3. Records the evaluator fragment's position for offset calculation
 * 4. Derives stage config from ESTADO_ETAPAS ratings
 * 5. For each stage mapped to "omitir", removes the fragment at the
 *    corresponding position (evaluatorPosition + fieldIndex + 1)
 * 6. Returns filtered fragments, stage config, and list of omitted stage names
 */
export function applyStageOmission(
  fragments: FragmentWithMeta[],
): StageOmissionResult | null {
  // Find the evaluator fragment (the one with ESTADO_ETAPAS block)
  let evaluatorIndex = -1;
  let evaluatorPosition = -1;
  let estadoEtapas: ExtractedBlock | undefined;

  for (let i = 0; i < fragments.length; i++) {
    const blocks = fragments[i].extractedBlocks;
    if (blocks?.ESTADO_ETAPAS) {
      evaluatorIndex = i;
      evaluatorPosition = fragments[i].position;
      estadoEtapas = blocks.ESTADO_ETAPAS;
      break;
    }
  }

  if (!estadoEtapas) {
    return null;
  }

  // Derive stage config
  const stageConfig = deriveStageConfig(estadoEtapas);

  // Calculate which positions to omit
  const omissionPositions = new Set<number>();
  const omittedStages: string[] = [];

  const fields = Object.entries(estadoEtapas);
  for (let fieldIndex = 0; fieldIndex < fields.length; fieldIndex++) {
    const [stageName] = fields[fieldIndex];
    const mode = stageConfig[stageName];
    if (mode === "omitir") {
      const targetPosition = evaluatorPosition + fieldIndex + 1;
      omissionPositions.add(targetPosition);
      omittedStages.push(stageName);
    }
  }

  // Filter out fragments at omission positions, keeping the evaluator
  const filteredFragments = fragments.filter((f, i) => {
    if (i === evaluatorIndex) return true;
    return !omissionPositions.has(f.position);
  });

  return {
    fragments: filteredFragments,
    stageConfig,
    omissions: omittedStages,
  };
}
