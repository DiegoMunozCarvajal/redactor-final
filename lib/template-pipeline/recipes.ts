import type { TemplateRecipe, RecipeId, SlotType } from "./trace-ir";
import type { RecipeRenderInput, RecipeRenderResult } from "./compiler";

// ---------------------------------------------------------------------------
// Slot descriptions — canonical prose used by every recipe that produces
// or depends on a given slot. Keys are SlotType (English enum values).
// ---------------------------------------------------------------------------

const SLOT_FUNCTIONS: Record<SlotType, string> = {
  concept: "Define el concepto clave de esta sección.",
  claim: "Enuncia una afirmación clara y defiende su relevancia.",
  example: "Ilustra el concepto con un ejemplo concreto y específico del tema.",
  question: "Plantea una pregunta que genere curiosidad en el lector.",
  objection: "Presenta la objeción más sólida a la afirmación anterior.",
  response: "Responde a la objeción sin desestimarla, reconociendo su valor.",
  evidence: "Aporta evidencia o datos que respalden la afirmación.",
  application: "Convierte el concepto en una aplicación práctica para el lector.",
};

// ---------------------------------------------------------------------------
// Recipe render functions
// ---------------------------------------------------------------------------

function ph(name: string, slot: SlotType): { name: string; function: string } {
  return { name, function: SLOT_FUNCTIONS[slot] };
}

interface RecipeDef {
  id: RecipeId;
  title: string;
  allowedResources: TemplateRecipe["allowedResources"];
  produces: SlotType[];
  localSlots: SlotType[];
  requiredDependencies: TemplateRecipe["requiredDependencies"];
  render(input: RecipeRenderInput): RecipeRenderResult;
}

const recipeDefs: RecipeDef[] = [
  {
    id: "opening_case",
    title: "Caso de apertura",
    allowedResources: ["case"],
    produces: ["concept", "example"],
    localSlots: ["concept", "example"],
    requiredDependencies: [],
    render(input: RecipeRenderInput): RecipeRenderResult {
      const c = input.produce("concept");
      const e = input.produce("example");
      return {
        name: "Caso de apertura",
        content: `Abre con un caso concreto que ilustre el {${c}}. Conecta el caso con {${c}} de forma natural. Incluye un {${e}} que haga tangible el concepto.`,
        userPrompt: `Escribe una apertura que presente un caso real o hipotético. El caso debe ilustrar el concepto {${c}}. Incluye un {${e}} concreto.`,
        function: "Apertura con caso concreto que introduce el tema.",
        notes: null,
        placeholders: [ph(c, "concept"), ph(e, "example")],
      };
    },
  },
  {
    id: "rhetorical_bridge",
    title: "Puente retórico",
    allowedResources: ["concept"],
    produces: ["concept"],
    localSlots: [],
    requiredDependencies: [{ relation: "supports", slotType: "concept" }],
    render(input: RecipeRenderInput): RecipeRenderResult {
      const dep = input.depNames[0]; // first required dependency
      return {
        name: "Puente retórico",
        content: `Conecta {${dep}} con la siguiente afirmación. Explica cómo {${dep}} lleva naturalmente al siguiente punto.`,
        userPrompt: `Escribe un puente que conecte {${dep}} con el tema siguiente. Haz que la transición sea fluida.`,
        function: "Transición entre el concepto anterior y el siguiente punto.",
        notes: null,
        placeholders: [ph(dep, "concept")],
      };
    },
  },
  {
    id: "claim_presentation",
    title: "Presentación de afirmación",
    allowedResources: ["claim"],
    produces: ["claim"],
    localSlots: ["claim"],
    requiredDependencies: [],
    render(input: RecipeRenderInput): RecipeRenderResult {
      const a = input.produce("claim");
      return {
        name: "Afirmación principal",
        content: `Enuncia y desarrolla {${a}}. Explica por qué {${a}} es relevante para el lector.`,
        userPrompt: `Presenta una afirmación clara y original sobre el tema: {${a}}. Defiende su importancia.`,
        function: "Afirmación central que estructura la sección.",
        notes: null,
        placeholders: [ph(a, "claim")],
      };
    },
  },
  {
    id: "claim_contrast",
    title: "Contraste de afirmación",
    allowedResources: ["claim"],
    produces: ["claim", "objection"],
    localSlots: ["objection"],
    requiredDependencies: [{ relation: "supports", slotType: "claim" }],
    render(input: RecipeRenderInput): RecipeRenderResult {
      const dep = input.depNames[0];
      const o = input.produce("objection");
      return {
        name: "Contraste",
        content: `Contrasta {${dep}} con una alternativa creíble: {${o}}. Muestra las dos caras sin tomar partido aún.`,
        userPrompt: `Contrasta {${dep}} con {${o}}. Presenta ambas perspectivas con honestidad intelectual.`,
        function: "Contraste entre la afirmación y una objeción creíble.",
        notes: null,
        placeholders: [ph(dep, "claim"), ph(o, "objection")],
      };
    },
  },
  {
    id: "quantitative_illustration",
    title: "Ilustración cuantitativa",
    allowedResources: ["claim"],
    produces: ["evidence"],
    localSlots: ["evidence"],
    requiredDependencies: [{ relation: "supports", slotType: "claim" }],
    render(input: RecipeRenderInput): RecipeRenderResult {
      const dep = input.depNames[0];
      const e = input.produce("evidence");
      return {
        name: "Ilustración cuantitativa",
        content: `Apoya {${dep}} con {${e}}. Usa datos, cifras o estadísticas que hagan tangible la afirmación.`,
        userPrompt: `Crea una ilustración cuantitativa que respalde {${dep}}. Genera {${e}} con datos específicos y relevantes para el tema.`,
        function: "Evidencia numérica que respalda la afirmación.",
        notes: null,
        placeholders: [ph(dep, "claim"), ph(e, "evidence")],
      };
    },
  },
  {
    id: "analogy_explanation",
    title: "Explicación por analogía",
    allowedResources: ["concept"],
    produces: ["example"],
    localSlots: ["example"],
    requiredDependencies: [{ relation: "supports", slotType: "concept" }],
    render(input: RecipeRenderInput): RecipeRenderResult {
      const dep = input.depNames[0];
      const e = input.produce("example");
      return {
        name: "Analogía",
        content: `Explica {${dep}} mediante una analogía: {${e}}. Mapea explícitamente cada elemento de la analogía al concepto.`,
        userPrompt: `Crea una analogía original sobre el tema para explicar {${dep}}. Desarrolla {${e}} y mapea sus elementos.`,
        function: "Analogía que mapea el concepto a un dominio familiar.",
        notes: null,
        placeholders: [ph(dep, "concept"), ph(e, "example")],
      };
    },
  },
  {
    id: "parallel_comparison",
    title: "Comparación paralela",
    allowedResources: ["case"],
    produces: ["example", "objection"],
    localSlots: ["example", "objection"],
    requiredDependencies: [],
    render(input: RecipeRenderInput): RecipeRenderResult {
      const e = input.produce("example");
      const o = input.produce("objection");
      return {
        name: "Comparación",
        content: `Compara dos perspectivas sobre el tema. Por un lado, {${e}}. Por otro, {${o}}. Usa criterios consistentes.`,
        userPrompt: `Compara dos enfoques: desarrolla {${e}} y contrasta con {${o}}. Aplica los mismos criterios a ambos.`,
        function: "Comparación de dos perspectivas con criterios comunes.",
        notes: null,
        placeholders: [ph(e, "example"), ph(o, "objection")],
      };
    },
  },
  {
    id: "definition",
    title: "Definición",
    allowedResources: ["concept"],
    produces: ["concept"],
    localSlots: ["concept"],
    requiredDependencies: [],
    render(input: RecipeRenderInput): RecipeRenderResult {
      const c = input.produce("concept");
      return {
        name: "Definición",
        content: `Define operativamente {${c}}. Delimita qué es y qué no es {${c}}.`,
        userPrompt: `Define {${c}} de forma operativa. Establece sus límites y alcance.`,
        function: "Definición operativa que delimita el concepto.",
        notes: null,
        placeholders: [ph(c, "concept")],
      };
    },
  },
  {
    id: "evidence_support",
    title: "Respaldo con evidencia",
    allowedResources: ["claim"],
    produces: ["evidence"],
    localSlots: ["evidence"],
    requiredDependencies: [{ relation: "supports", slotType: "claim" }],
    render(input: RecipeRenderInput): RecipeRenderResult {
      const dep = input.depNames[0];
      const e = input.produce("evidence");
      return {
        name: "Evidencia",
        content: `Respalda {${dep}} con {${e}}. La evidencia debe ser concreta y verificable.`,
        userPrompt: `Aporta evidencia para respaldar {${dep}}. Desarrolla {${e}} con datos concretos.`,
        function: "Evidencia que respalda la afirmación.",
        notes: null,
        placeholders: [ph(dep, "claim"), ph(e, "evidence")],
      };
    },
  },
  {
    id: "objection",
    title: "Objeción",
    allowedResources: ["claim"],
    produces: ["objection"],
    localSlots: ["objection"],
    requiredDependencies: [{ relation: "supports", slotType: "claim" }],
    render(input: RecipeRenderInput): RecipeRenderResult {
      const dep = input.depNames[0];
      const o = input.produce("objection");
      return {
        name: "Objeción",
        content: `Presenta la objeción más sólida a {${dep}}: {${o}}. No la debilites — preséntala con toda su fuerza.`,
        userPrompt: `Formula {${o}} como la crítica más fuerte posible a {${dep}}. No la caricaturices.`,
        function: "Objeción sólida presentada con honestidad intelectual.",
        notes: null,
        placeholders: [ph(dep, "claim"), ph(o, "objection")],
      };
    },
  },
  {
    id: "response",
    title: "Respuesta",
    allowedResources: ["claim"],
    produces: ["response"],
    localSlots: ["response"],
    requiredDependencies: [{ relation: "supports", slotType: "objection" }],
    render(input: RecipeRenderInput): RecipeRenderResult {
      const dep = input.depNames[0];
      const r = input.produce("response");
      return {
        name: "Respuesta",
        content: `Responde a {${dep}} con {${r}}. Reconoce el valor de la objeción antes de responder.`,
        userPrompt: `Responde a {${dep}} con {${r}}. No desestimes la objeción — intégrala en una síntesis más completa.`,
        function: "Respuesta que integra la objeción en una visión más completa.",
        notes: null,
        placeholders: [ph(dep, "objection"), ph(r, "response")],
      };
    },
  },
  {
    id: "application",
    title: "Aplicación",
    allowedResources: ["concept"],
    produces: ["application"],
    localSlots: ["application"],
    requiredDependencies: [{ relation: "supports", slotType: "concept" }],
    render(input: RecipeRenderInput): RecipeRenderResult {
      const dep = input.depNames[0];
      const a = input.produce("application");
      return {
        name: "Aplicación práctica",
        content: `Convierte {${dep}} en {${a}}. Muestra cómo aplicar el concepto en una situación real.`,
        userPrompt: `Transforma {${dep}} en {${a}}. Describe una aplicación concreta que el lector pueda poner en práctica.`,
        function: "Aplicación práctica del concepto para el lector.",
        notes: null,
        placeholders: [ph(dep, "concept"), ph(a, "application")],
      };
    },
  },
  {
    id: "transition",
    title: "Transición",
    allowedResources: ["concept"],
    produces: [],
    localSlots: [],
    requiredDependencies: [{ relation: "supports", slotType: "concept" }],
    render(input: RecipeRenderInput): RecipeRenderResult {
      const dep = input.depNames[0];
      return {
        name: "Transición",
        content: `Conecta {${dep}} con la siguiente sección. Prepara al lector para el cambio de tema.`,
        userPrompt: `Escribe una transición que conecte {${dep}} con el siguiente tema.`,
        function: "Transición que conecta el concepto actual con la siguiente sección.",
        notes: null,
        placeholders: [ph(dep, "concept")],
      };
    },
  },
  {
    id: "synthesis_close",
    title: "Cierre sintético",
    allowedResources: ["claim"],
    produces: [],
    localSlots: [],
    requiredDependencies: [{ relation: "supports", slotType: "claim" }],
    render(input: RecipeRenderInput): RecipeRenderResult {
      const dep = input.depNames[0];
      return {
        name: "Cierre",
        content: `Sintetiza {${dep}} y cierra sin introducir nuevos argumentos. Deja al lector con una idea clara.`,
        userPrompt: `Sintetiza {${dep}}. No introduzcas nuevos argumentos — cierra con claridad.`,
        function: "Cierre que sintetiza sin introducir nuevos argumentos.",
        notes: null,
        placeholders: [ph(dep, "claim")],
      };
    },
  },
];

// ---------------------------------------------------------------------------
// Registry — cast through unknown to add render to TemplateRecipe
// ---------------------------------------------------------------------------

export const TEMPLATE_RECIPE_REGISTRY: ReadonlyMap<RecipeId, TemplateRecipe> =
  new Map(recipeDefs.map((r) => [r.id, r as unknown as TemplateRecipe]));
