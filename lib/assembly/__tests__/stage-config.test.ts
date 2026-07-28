import { describe, it, expect } from "vitest";
import {
  deriveStageConfig,
  applyStageOmission,
  type FragmentWithMeta,
} from "../stage-config";

// ---------------------------------------------------------------------------
// deriveStageConfig
// ---------------------------------------------------------------------------

describe("deriveStageConfig", () => {
  it("maps all 4 ratings to their correct modes", () => {
    const block = {
      etapa_uno: "respaldada",
      etapa_dos: "plausible",
      etapa_tres: "no_respaldada_con_evidencia_relevante",
      etapa_cuatro: "no_respaldada_sin_evidencia_relevante",
    };

    const config = deriveStageConfig(block);

    expect(config).toEqual({
      etapa_uno: "desarrollar",
      etapa_dos: "hipotesis",
      etapa_tres: "limite",
      etapa_cuatro: "omitir",
    });
  });

  it("defaults unknown ratings to desarrollar", () => {
    const block = {
      etapa_uno: "unknown_rating",
      etapa_dos: "valorpoco_claro",
    };

    const config = deriveStageConfig(block);

    expect(config).toEqual({
      etapa_uno: "desarrollar",
      etapa_dos: "desarrollar",
    });
  });

  it("returns empty config for empty block", () => {
    const config = deriveStageConfig({});
    expect(config).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// applyStageOmission
// ---------------------------------------------------------------------------

describe("applyStageOmission", () => {
  it("returns null when no fragment has ESTADO_ETAPAS", () => {
    const fragments: FragmentWithMeta[] = [
      {
        id: "f1",
        title: "Fragment 1",
        content: "Content 1",
        position: 1,
      },
      {
        id: "f2",
        title: "Fragment 2",
        content: "Content 2",
        position: 2,
      },
    ];

    const result = applyStageOmission(fragments);
    expect(result).toBeNull();
  });

  it("removes fragment when mode is omitir", () => {
    const fragments: FragmentWithMeta[] = [
      {
        id: "eva",
        title: "Evaluator",
        content: "Evaluates stages",
        position: 1,
        extractedBlocks: {
          ESTADO_ETAPAS: {
            tema_a_desarrollar: "no_respaldada_sin_evidencia_relevante",
          },
        },
      },
      {
        id: "frag1",
        title: "Tema a Desarrollar",
        content: "Content for omitted stage",
        position: 2,
      },
    ];

    const result = applyStageOmission(fragments);

    expect(result).not.toBeNull();
    expect(result!.omissions).toEqual(["tema_a_desarrollar"]);
    expect(result!.fragments).toHaveLength(1);
    expect(result!.fragments[0].id).toBe("eva");
  });

  it("keeps fragment when mode is not omitir (desarrollar)", () => {
    const fragments: FragmentWithMeta[] = [
      {
        id: "eva",
        title: "Evaluator",
        content: "Evaluates stages",
        position: 1,
        extractedBlocks: {
          ESTADO_ETAPAS: {
            tema_a_desarrollar: "respaldada",
          },
        },
      },
      {
        id: "frag1",
        title: "Tema a Desarrollar",
        content: "Content for supported stage",
        position: 2,
      },
    ];

    const result = applyStageOmission(fragments);

    expect(result).not.toBeNull();
    expect(result!.omissions).toEqual([]);
    expect(result!.fragments).toHaveLength(2);
  });

  it("keeps fragment when mode is hipotesis", () => {
    const fragments: FragmentWithMeta[] = [
      {
        id: "eva",
        title: "Evaluator",
        content: "Evaluates stages",
        position: 1,
        extractedBlocks: {
          ESTADO_ETAPAS: {
            tema_a_desarrollar: "plausible",
          },
        },
      },
      {
        id: "frag1",
        title: "Tema a Desarrollar",
        content: "Content for plausible stage",
        position: 2,
      },
    ];

    const result = applyStageOmission(fragments);

    expect(result).not.toBeNull();
    expect(result!.omissions).toEqual([]);
    expect(result!.fragments).toHaveLength(2);
  });

  it("keeps fragment when mode is limite", () => {
    const fragments: FragmentWithMeta[] = [
      {
        id: "eva",
        title: "Evaluator",
        content: "Evaluates stages",
        position: 1,
        extractedBlocks: {
          ESTADO_ETAPAS: {
            etapa_limite: "no_respaldada_con_evidencia_relevante",
          },
        },
      },
      {
        id: "frag1",
        title: "Etapa Limite",
        content: "Content for limite stage",
        position: 2,
      },
    ];

    const result = applyStageOmission(fragments);

    expect(result).not.toBeNull();
    expect(result!.omissions).toEqual([]);
    expect(result!.fragments).toHaveLength(2);
  });

  it("handles multiple omissions correctly", () => {
    const fragments: FragmentWithMeta[] = [
      {
        id: "eva",
        title: "Evaluator",
        content: "Evaluates stages",
        position: 1,
        extractedBlocks: {
          ESTADO_ETAPAS: {
            etapa_uno: "respaldada",
            etapa_dos: "no_respaldada_sin_evidencia_relevante",
            etapa_tres: "plausible",
            etapa_cuatro: "no_respaldada_sin_evidencia_relevante",
          },
        },
      },
      {
        id: "f1",
        title: "Etapa Uno",
        content: "Desarrollar",
        position: 2,
      },
      {
        id: "f2",
        title: "Etapa Dos",
        content: "Omitir",
        position: 3,
      },
      {
        id: "f3",
        title: "Etapa Tres",
        content: "Hipotesis",
        position: 4,
      },
      {
        id: "f4",
        title: "Etapa Cuatro",
        content: "Omitir",
        position: 5,
      },
    ];

    const result = applyStageOmission(fragments);

    expect(result).not.toBeNull();
    expect(result!.omissions).toEqual(["etapa_dos", "etapa_cuatro"]);
    expect(result!.fragments).toHaveLength(3);
    expect(result!.fragments.map((f) => f.id)).toEqual(["eva", "f1", "f3"]);
  });

  it("returns all fragments when no stages are omitted (zero omissions)", () => {
    const fragments: FragmentWithMeta[] = [
      {
        id: "eva",
        title: "Evaluator",
        content: "Evaluates stages",
        position: 1,
        extractedBlocks: {
          ESTADO_ETAPAS: {
            etapa_uno: "respaldada",
            etapa_dos: "plausible",
          },
        },
      },
      {
        id: "f1",
        title: "Etapa Uno",
        content: "Content",
        position: 2,
      },
      {
        id: "f2",
        title: "Etapa Dos",
        content: "Content",
        position: 3,
      },
    ];

    const result = applyStageOmission(fragments);

    expect(result).not.toBeNull();
    expect(result!.omissions).toEqual([]);
    expect(result!.fragments).toHaveLength(3);
    expect(result!.stageConfig).toEqual({
      etapa_uno: "desarrollar",
      etapa_dos: "hipotesis",
    });
  });

  it("handles evaluator at the end with no subsequent fragments", () => {
    const fragments: FragmentWithMeta[] = [
      {
        id: "f1",
        title: "Fragment 1",
        content: "Content",
        position: 1,
      },
      {
        id: "eva",
        title: "Evaluator",
        content: "Evaluates stages",
        position: 2,
        extractedBlocks: {
          ESTADO_ETAPAS: {
            etapa_faltante: "no_respaldada_sin_evidencia_relevante",
          },
        },
      },
    ];

    const result = applyStageOmission(fragments);

    // No subsequent fragments to omit, evaluator kept
    expect(result).not.toBeNull();
    expect(result!.omissions).toEqual(["etapa_faltante"]);
    expect(result!.fragments).toHaveLength(2);
  });

  it("handles evaluator with 1 field and the next fragment is omitted", () => {
    const fragments: FragmentWithMeta[] = [
      {
        id: "eva",
        title: "Evaluator",
        content: "Evaluates",
        position: 3,
        extractedBlocks: {
          ESTADO_ETAPAS: {
            unica_etapa: "no_respaldada_sin_evidencia_relevante",
          },
        },
      },
      {
        id: "target",
        title: "Target",
        content: "The omitted fragment",
        position: 4,
      },
    ];

    const result = applyStageOmission(fragments);

    expect(result).not.toBeNull();
    expect(result!.omissions).toEqual(["unica_etapa"]);
    expect(result!.fragments).toHaveLength(1);
    expect(result!.fragments[0].id).toBe("eva");

    // Target fragment at evaluatorPosition + 0 + 1 = 4 is removed
  });
});
