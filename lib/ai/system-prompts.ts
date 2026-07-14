import { SYSTEM_PROMPT_V5 } from './system-prompt-v5';

export { SYSTEM_PROMPT_V5 } from './system-prompt-v5';

/**
 * Embedded system prompts and style rules used across the generation pipeline.
 * Extracted from lib/generate.ts to keep that file focused on generation logic.
 */
export const DEFAULT_SYSTEM_PROMPT = SYSTEM_PROMPT_V5;

// Shared style rules injected into assembly, critique, and correction system prompts.
// These rules ensure consistent anti-pattern avoidance across the entire pipeline.
export const STYLE_RULES = `<reglas-estilo>
Aplica estas reglas al texto que produzcas:

<regla id="una-idea">**Una idea por párrafo.** Máximo 5 oraciones por párrafo. Oraciones cortas (15-25 palabras) con ritmo variado.</regla>

<regla id="voz-activa">**Voz activa.** Usas pasiva solo cuando el sujeto no importa o es desconocido.</regla>

<regla id="respaldo">**Afirmación → anclaje.** Cada afirmación no obvia la aterrizas con un ejemplo cotidiano, una analogía, un dato, o un razonamiento. La prioridad es que el lector entienda, no impresionarlo con citas.</regla>

<regla id="concreto">**Abstracto → concreto.** Si mencionas un concepto abstracto, lo aterrizas de inmediato con una ilustración.</regla>

<regla id="atribucion">**Honestidad intelectual.** NUNCA inventes un autor, un estudio, una fecha ni una institución. Prefieres un ejemplo propio o una analogía bien construida que una referencia inventada. Si no recuerdas los detalles exactos de una fuente, no la menciones — usa otra forma de anclaje.</regla>

<regla id="precision">**Precisión léxica.** Eliminas adjetivos que no añaden información verificable: "integral", "profundo", "innovador", "revolucionario", "fascinante". Eliminas "realmente", "verdaderamente", "básicamente", "simplemente".</regla>

<regla id="transiciones">**Transiciones que conectan.** El lector nunca se pregunta "¿y esto qué tiene que ver?". Cada párrafo retoma una palabra, imagen o pregunta del anterior.</regla>

<regla id="reencuadres" critica="true">**Reencuadres afirmativos. PROHIBIDO.** No uses estructuras de contraste correctivo: "No es X, es Y", "No es X, sino Y", "X no es A, es B", ni ninguna fórmula que niegue para luego afirmar. Esta regla es inflexible y tiene prioridad sobre cualquier otra consideración estilística. Si detectas esta estructura en tu texto, debes reescribir el pasaje completo.
❌ "No es falta de talento: es falta de práctica."
❌ "La gente no abandona sus metas por falta de motivación. Las abandona por falta de un sistema."
❌ "No fallan por falta de intención, sino porque el sistema es pesado."
✅ "La práctica constante explica mejor el progreso que una supuesta falta de talento."
✅ "Un método de estudio con sesiones cortas y frecuentes produce mejor retención que los maratones de última hora."
✅ "Una rutina fija —escribir a las 7am cada día— produce más páginas que esperar a que llegue la inspiración."</regla>

</reglas-estilo>`;
