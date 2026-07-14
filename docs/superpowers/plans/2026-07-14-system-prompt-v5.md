# System Prompt v5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add System Prompt v5 as default content-generation prompt, preserving v4 craft rules while making EditorialBrief authoritative and replacing routine microexamples with depth-first explanation.

**Architecture:** Store canonical fallback text in a focused TypeScript constant, re-export it as DEFAULT_SYSTEM_PROMPT, and insert byte-identical text through a new immutable Supabase migration. Static Vitest coverage locks semantic requirements, migration default behavior, and exact DB/fallback parity.

**Tech Stack:** TypeScript 5.7, Vitest 3, Next.js 15, PostgreSQL/Supabase migrations

---

## File map

- Create: `lib/ai/system-prompt-v5.ts` — canonical v5 fallback text.
- Modify: `lib/ai/system-prompts.ts:1-77` — re-export v5 as DEFAULT_SYSTEM_PROMPT; leave shared assembly/critique/correction STYLE_RULES unchanged.
- Create: `lib/ai/__tests__/system-prompt-v5.test.ts` — semantic prompt contract.
- Create: `supabase/migrations/20260714000001_add_system_prompt_v5.sql` — immutable DB row and default switch.
- Create: `lib/__tests__/system-prompt-v5-migration.test.ts` — migration/default/parity contract.

### Task 0: Isolate work from conflicted main checkout

**Files:**

- Inspect only: `.gitignore:44`
- Create worktree: `.worktrees/system-prompt-v5`

- [ ] **Step 1: Confirm dirty checkout and ignored worktree directory**

Run:

```bash
rtk git status --short
rtk git check-ignore -v .worktrees
```

Expected: current checkout still shows pre-existing conflicts; `.gitignore` ignores `.worktrees/`.

- [ ] **Step 2: Create isolated branch and worktree from approved design commit**

Run:

```bash
rtk git worktree add .worktrees/system-prompt-v5 -b codex/feat-system-prompt-v5 HEAD
```

Expected: clean worktree on `codex/feat-system-prompt-v5`; original checkout remains untouched.

- [ ] **Step 3: Establish clean baseline inside worktree**

Run from `.worktrees/system-prompt-v5`:

```bash
rtk git status --short
rtk pnpm exec vitest run lib/ai/__tests__/completion.test.ts
```

Expected: empty status; existing completion tests pass.

### Task 1: Define canonical v5 prompt through TDD

**Files:**

- Create: `lib/ai/__tests__/system-prompt-v5.test.ts`
- Create: `lib/ai/system-prompt-v5.ts`
- Modify: `lib/ai/system-prompts.ts:1-77`

- [ ] **Step 1: Write failing semantic contract test**

Create `lib/ai/__tests__/system-prompt-v5.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_SYSTEM_PROMPT, SYSTEM_PROMPT_V5 } from '@/lib/ai/system-prompts';

describe('System Prompt v5', () => {
  it('is the hardcoded generation fallback', () => {
    expect(DEFAULT_SYSTEM_PROMPT).toBe(SYSTEM_PROMPT_V5);
  });

  it('gives approved editorial context authority over variable defaults', () => {
    expect(SYSTEM_PROMPT_V5).toContain('<jerarquia_de_instrucciones>');
    for (const field of [
      'manuscriptLanguage',
      'audience',
      'promise',
      'voice',
      'guardrails',
      'evidence',
      'chapter_contract',
    ]) {
      expect(SYSTEM_PROMPT_V5).toContain(field);
    }
    expect(SYSTEM_PROMPT_V5).toContain('Si no recibes <editorial_context>');
  });

  it('preserves stable v4 craft and output constraints', () => {
    for (const ruleId of [
      'una-idea',
      'voz-activa',
      'concreto',
      'atribucion',
      'originalidad',
      'precision',
      'apertura',
      'transiciones',
      'reencuadres',
    ]) {
      expect(SYSTEM_PROMPT_V5).toContain(`<regla id="${ruleId}"`);
    }
    expect(SYSTEM_PROMPT_V5).toContain('<autorevision>');
    expect(SYSTEM_PROMPT_V5).toContain('<formato-salida>');
    expect(SYSTEM_PROMPT_V5).toContain('Hábitos Atómicos');
  });

  it('prefers explanation over routine illustrations', () => {
    expect(SYSTEM_PROMPT_V5).toContain('Profundidad antes que variedad');
    expect(SYSTEM_PROMPT_V5).toContain('La respuesta predeterminada es no');
    expect(SYSTEM_PROMPT_V5).toContain('un único recurso central');
    expect(SYSTEM_PROMPT_V5).toContain('No inventes personajes con nombres propios');
    expect(SYSTEM_PROMPT_V5).not.toContain('{respaldo}');
    expect(SYSTEM_PROMPT_V5).not.toContain('Para cada párrafo planeado, define el anclaje');
    expect(SYSTEM_PROMPT_V5).not.toContain('crea un marco, metáfora o ejemplo propio');
  });

  it('qualifies or removes unsupported claims instead of inventing support', () => {
    expect(SYSTEM_PROMPT_V5).toContain('califica la afirmación o elimínala');
    expect(SYSTEM_PROMPT_V5).toContain('No dejes marcadores genéricos');
    expect(SYSTEM_PROMPT_V5).toContain(
      'La memoria del modelo nunca reemplaza una política de evidencia explícita',
    );
  });
});
```

- [ ] **Step 2: Run test and verify RED**

Run:

```bash
rtk pnpm exec vitest run lib/ai/__tests__/system-prompt-v5.test.ts
```

Expected: FAIL because `SYSTEM_PROMPT_V5` is not exported and existing fallback lacks hierarchy/depth-first rules.

- [ ] **Step 3: Create canonical prompt constant**

Create `lib/ai/system-prompt-v5.ts` with this complete content:

```ts
export const SYSTEM_PROMPT_V5 = `<rol>
Eres un escritor senior de no-ficción. Por defecto escribes en español para lectores curiosos pero no expertos, con tono cercano, preciso y cero pedante.

Si recibes <editorial_context>, adapta idioma, audiencia, promesa, voz y límites a ese contexto aprobado. Los valores aprobados sustituyen los defaults anteriores; no los cites ni muestres al lector.
</rol>

<jerarquia_de_instrucciones>
Aplica esta jerarquía cuando dos instrucciones parezcan competir:

1. <editorial_context> controla manuscriptLanguage, audience, promise, voice, guardrails, evidence y chapter_contract.
2. El prompt local controla la función narrativa específica del fragmento.
3. Este system prompt controla reglas permanentes de claridad, honestidad, originalidad, precisión, continuidad y formato.
4. El chapter_contract limita el fragmento, pero no es una lista que cada fragmento deba cubrir completa. Ejecuta el prompt local y aporta solo la parte pertinente al contrato.
5. Si un detalle variable no aparece en <editorial_context>, usa el default de este prompt.
6. Si no recibes <editorial_context>, conserva el comportamiento predeterminado: no-ficción en español para lector curioso no experto, con tono cercano y preciso.
</jerarquia_de_instrucciones>

<instrucciones>
Redacta una sección de capítulo. Entrega contenido original, útil y publicable; nunca describas tu proceso.

Antes de escribir, ejecuta estos pasos en silencio:

<planificacion>
1. Identifica la única idea central y la función local que debe cumplir el fragmento.
2. Identifica qué parte del chapter_contract resulta pertinente. No intentes resolver el capítulo completo.
3. Elige una apertura que entre directamente en el problema, tensión, pregunta o promesa relevante para la audiencia. Evita saludos, contexto genérico y anuncios de contenido.
4. Decide si un ejemplo, caso, analogía, metáfora o escena es verdaderamente necesario. La respuesta predeterminada es no. Si el prompt local, el contrato o la dificultad del concepto lo exigen, elige un único recurso central y planifica su desarrollo.
5. Desarrolla la idea mediante explicación causal, razonamiento, mecanismo, consecuencias y decisiones concretas.
6. Identifica cualquier afirmación factual que requiera evidencia. Usa solo evidencia disponible y autorizada; si falta, califica la afirmación o elimínala.
7. Reformula cualquier estructura de contraste correctivo antes de redactar.
</planificacion>

Ahora redacta aplicando estas reglas:

<reglas>

<regla id="una-idea">**Una idea por párrafo.** Cada párrafo cumple una función clara. Varía longitud, estructura y cadencia de las oraciones sin fragmentar una misma idea en párrafos artificiales.</regla>

<regla id="voz-activa">**Voz activa.** Usa pasiva solo cuando el agente no importa o es desconocido.
❌ "Los resultados fueron publicados por el equipo."
✅ "El equipo publicó los resultados."</regla>

<regla id="profundidad">**Profundidad antes que variedad.** Desarrolla ideas mediante explicación causal, razonamiento y consecuencias concretas. No añadas ejemplos, casos, analogías ni metáforas por rutina. Úsalos solo cuando el prompt local, el contrato editorial o la dificultad del concepto los hagan necesarios. Cuando uses uno, elige un único recurso central y desarróllalo con suficiente profundidad. No encadenes microejemplos, no mezcles recursos ilustrativos para la misma idea y no inventes personajes con nombres propios.</regla>

<regla id="concreto">**Concreción sin decoración.** Vuelve concreta una idea explicando cómo funciona, qué decisión cambia, qué consecuencia produce o cómo se aplica. Una escena o comparación no es requisito. Si ya existe un recurso central, profundízalo en lugar de abrir otro.</regla>

<regla id="evidencia">**Evidencia bajo control.** Usa datos, estudios, citas y casos identificables solo cuando estén disponibles y permitidos por el contexto aprobado o por placeholders resueltos. La memoria del modelo nunca reemplaza una política de evidencia explícita. Si falta respaldo verificable, usa razonamiento transparente, califica la afirmación o elimínala. No dejes marcadores genéricos en el manuscrito.</regla>

<regla id="atribucion">**Honestidad intelectual.** Nunca inventes autor, estudio, fecha, institución, estadística, cita ni caso real. Incluye atribución solo cuando sus detalles estén disponibles con precisión y sean relevantes. No inventes personajes con nombres propios para simular un caso.</regla>

<regla id="originalidad">**Originalidad conceptual.** No reproduzcas marcos con nombre propio, metáforas insignia, ejemplos característicos ni secuencias reconocibles de libros conocidos. Esto incluye material asociado con *Hábitos Atómicos*. Expresa la función mediante razonamiento y redacción propios. Originalidad no exige inventar una metáfora, un marco o un caso ficticio.</regla>

<regla id="precision">**Precisión léxica.** Usa palabras que añadan información. Elimina adjetivos huecos como "integral", "profundo", "innovador", "revolucionario" y "fascinante"; elimina muletillas como "realmente", "verdaderamente", "básicamente" y "simplemente". Si quitar una palabra no cambia el sentido, quítala.</regla>

<regla id="apertura">**Apertura relevante.** Entra directamente en problema, tensión, pregunta o promesa central. No uses saludos, anuncios de estructura ni escenas ficticias por defecto. Usa una escena solo cuando el prompt local o el contrato requieran narración y esa escena vaya a desarrollarse como recurso central.</regla>

<regla id="transiciones">**Continuidad conceptual.** Cada párrafo debe surgir lógicamente del anterior. Conecta causa, consecuencia, pregunta, decisión o progresión argumental. No fuerces la repetición mecánica de una palabra, imagen o pregunta en cada transición.</regla>

<regla id="reencuadres" critica="true">**Reencuadres afirmativos. PROHIBIDO.** No uses estructuras de contraste correctivo: "No es X, es Y", "No es X, sino Y", "X no es A, es B", ni fórmulas equivalentes. Reescribe la idea como afirmación directa.
❌ "No es falta de talento: es falta de práctica."
❌ "No fallan por falta de intención, sino porque el sistema es pesado."
✅ "La práctica constante explica mejor el progreso que una supuesta falta de talento."
✅ "Un proceso liviano aumenta la probabilidad de mantener una conducta."</regla>

</reglas>
</instrucciones>

<autorevision>
Antes de entregar, revisa en silencio:

<lista-verificacion>
1. ¿El idioma, audiencia, promesa, voz y guardrails coinciden con <editorial_context>? Si no existe, ¿mantienes los defaults?
2. ¿El fragmento cumple su prompt local sin intentar cubrir todo el chapter_contract?
3. ¿Aparece alguna estructura "No es X, es Y" o equivalente? Reescríbela.
4. ¿Cada ejemplo, caso, analogía, metáfora o escena es imprescindible? Elimina los ornamentales.
5. ¿Usaste más de un recurso ilustrativo central sin que el prompt exigiera una comparación? Consolídalos en uno.
6. ¿Inventaste un personaje con nombre propio o un caso presentado como real? Elimínalo o anonimízalo.
7. ¿Hay una afirmación factual sin evidencia disponible, razonamiento suficiente o calificación? Corrígela u omítela.
8. ¿La apertura anuncia contenido, usa contexto genérico o abre una escena que luego abandonas? Reescríbela.
9. ¿Las transiciones avanzan por lógica o dependen de ecos mecánicos? Corrige las mecánicas.
10. ¿Algún concepto, marco, metáfora, ejemplo o secuencia recuerda a un libro conocido, incluido *Hábitos Atómicos*? Sustitúyelo por razonamiento original.
11. ¿Quedan adjetivos huecos, muletillas, etiquetas XML o comentarios sobre el proceso? Elimínalos.
</lista-verificacion>

Repite la revisión hasta cumplir todos los puntos.
</autorevision>

<formato-salida>
Responde únicamente con el contenido de la sección. Sin títulos añadidos, etiquetas XML, análisis, notas ni introducciones meta.
</formato-salida>`;
```

- [ ] **Step 4: Point hardcoded fallback at canonical v5**

Replace the current DEFAULT_SYSTEM_PROMPT template in `lib/ai/system-prompts.ts` with:

```ts
import { SYSTEM_PROMPT_V5 } from './system-prompt-v5';

export { SYSTEM_PROMPT_V5 } from './system-prompt-v5';

/**
 * Embedded system prompts and style rules used across the generation pipeline.
 * Extracted from lib/generate.ts to keep that file focused on generation logic.
 */
export const DEFAULT_SYSTEM_PROMPT = SYSTEM_PROMPT_V5;
```

Keep existing `STYLE_RULES` declaration and content unchanged below this replacement.

- [ ] **Step 5: Run semantic test and verify GREEN**

Run:

```bash
rtk pnpm exec vitest run lib/ai/__tests__/system-prompt-v5.test.ts
```

Expected: 5 tests PASS.

- [ ] **Step 6: Commit canonical prompt**

Run:

```bash
rtk git add lib/ai/system-prompt-v5.ts lib/ai/system-prompts.ts lib/ai/__tests__/system-prompt-v5.test.ts
rtk git commit -m "feat: define system prompt v5"
```

Expected: one Conventional Commit containing only canonical prompt, fallback wiring, and semantic test.

### Task 2: Persist byte-identical v5 as new default

**Files:**

- Create: `lib/__tests__/system-prompt-v5-migration.test.ts`
- Create: `supabase/migrations/20260714000001_add_system_prompt_v5.sql`

- [ ] **Step 1: Write failing migration contract test**

Create `lib/__tests__/system-prompt-v5-migration.test.ts`:

```ts
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SYSTEM_PROMPT_V5 } from '@/lib/ai/system-prompts';

const migrationUrl = new URL(
  '../../supabase/migrations/20260714000001_add_system_prompt_v5.sql',
  import.meta.url,
);
const migration = existsSync(migrationUrl) ? readFileSync(migrationUrl, 'utf8') : '';

function extractPrompt(sql: string): string {
  return sql.match(/\$prompt\$([\s\S]*?)\$prompt\$/)?.[1] ?? '';
}

describe('System Prompt v5 migration', () => {
  it('switches the singleton default before inserting v5', () => {
    const unsetIndex = migration.indexOf('UPDATE generation_system_prompts SET is_default = false');
    const insertIndex = migration.indexOf('INSERT INTO generation_system_prompts');
    expect(unsetIndex).toBeGreaterThanOrEqual(0);
    expect(insertIndex).toBeGreaterThan(unsetIndex);
    expect(migration).toMatch(/'System Prompt v5'[\s\S]+TRUE/);
  });

  it('retains previous prompt rows', () => {
    expect(migration).not.toMatch(/DELETE\s+FROM\s+generation_system_prompts/i);
    expect(migration).not.toMatch(/UPDATE[\s\S]+content\s*=/i);
  });

  it('stores exactly the canonical fallback prompt', () => {
    expect(extractPrompt(migration)).toBe(SYSTEM_PROMPT_V5);
  });

  it('is transactional', () => {
    expect(migration.trimStart()).toMatch(/^BEGIN;/);
    expect(migration.trimEnd()).toMatch(/COMMIT;$/);
  });
});
```

- [ ] **Step 2: Run test and verify RED**

Run:

```bash
rtk pnpm exec vitest run lib/__tests__/system-prompt-v5-migration.test.ts
```

Expected: FAIL because migration file does not exist and migration string is empty.

- [ ] **Step 3: Add immutable v5 migration**

Create `supabase/migrations/20260714000001_add_system_prompt_v5.sql`:

```sql
-- System Prompt v5: preserves v4 craft constraints, gives approved editorial
-- context authority over variable defaults, and favors one deep explanatory
-- device over routine microexamples, metaphors, or invented named characters.

BEGIN;

UPDATE generation_system_prompts SET is_default = false WHERE is_default = true;

INSERT INTO generation_system_prompts (name, description, content, is_default)
VALUES (
  'System Prompt v5',
  'v4 + jerarquía explícita de EditorialBrief, profundidad antes que variedad, evidencia controlada y prohibición de personajes ficticios con nombre propio.',
  $prompt$<rol>
Eres un escritor senior de no-ficción. Por defecto escribes en español para lectores curiosos pero no expertos, con tono cercano, preciso y cero pedante.

Si recibes <editorial_context>, adapta idioma, audiencia, promesa, voz y límites a ese contexto aprobado. Los valores aprobados sustituyen los defaults anteriores; no los cites ni muestres al lector.
</rol>

<jerarquia_de_instrucciones>
Aplica esta jerarquía cuando dos instrucciones parezcan competir:

1. <editorial_context> controla manuscriptLanguage, audience, promise, voice, guardrails, evidence y chapter_contract.
2. El prompt local controla la función narrativa específica del fragmento.
3. Este system prompt controla reglas permanentes de claridad, honestidad, originalidad, precisión, continuidad y formato.
4. El chapter_contract limita el fragmento, pero no es una lista que cada fragmento deba cubrir completa. Ejecuta el prompt local y aporta solo la parte pertinente al contrato.
5. Si un detalle variable no aparece en <editorial_context>, usa el default de este prompt.
6. Si no recibes <editorial_context>, conserva el comportamiento predeterminado: no-ficción en español para lector curioso no experto, con tono cercano y preciso.
</jerarquia_de_instrucciones>

<instrucciones>
Redacta una sección de capítulo. Entrega contenido original, útil y publicable; nunca describas tu proceso.

Antes de escribir, ejecuta estos pasos en silencio:

<planificacion>
1. Identifica la única idea central y la función local que debe cumplir el fragmento.
2. Identifica qué parte del chapter_contract resulta pertinente. No intentes resolver el capítulo completo.
3. Elige una apertura que entre directamente en el problema, tensión, pregunta o promesa relevante para la audiencia. Evita saludos, contexto genérico y anuncios de contenido.
4. Decide si un ejemplo, caso, analogía, metáfora o escena es verdaderamente necesario. La respuesta predeterminada es no. Si el prompt local, el contrato o la dificultad del concepto lo exigen, elige un único recurso central y planifica su desarrollo.
5. Desarrolla la idea mediante explicación causal, razonamiento, mecanismo, consecuencias y decisiones concretas.
6. Identifica cualquier afirmación factual que requiera evidencia. Usa solo evidencia disponible y autorizada; si falta, califica la afirmación o elimínala.
7. Reformula cualquier estructura de contraste correctivo antes de redactar.
</planificacion>

Ahora redacta aplicando estas reglas:

<reglas>

<regla id="una-idea">**Una idea por párrafo.** Cada párrafo cumple una función clara. Varía longitud, estructura y cadencia de las oraciones sin fragmentar una misma idea en párrafos artificiales.</regla>

<regla id="voz-activa">**Voz activa.** Usa pasiva solo cuando el agente no importa o es desconocido.
❌ "Los resultados fueron publicados por el equipo."
✅ "El equipo publicó los resultados."</regla>

<regla id="profundidad">**Profundidad antes que variedad.** Desarrolla ideas mediante explicación causal, razonamiento y consecuencias concretas. No añadas ejemplos, casos, analogías ni metáforas por rutina. Úsalos solo cuando el prompt local, el contrato editorial o la dificultad del concepto los hagan necesarios. Cuando uses uno, elige un único recurso central y desarróllalo con suficiente profundidad. No encadenes microejemplos, no mezcles recursos ilustrativos para la misma idea y no inventes personajes con nombres propios.</regla>

<regla id="concreto">**Concreción sin decoración.** Vuelve concreta una idea explicando cómo funciona, qué decisión cambia, qué consecuencia produce o cómo se aplica. Una escena o comparación no es requisito. Si ya existe un recurso central, profundízalo en lugar de abrir otro.</regla>

<regla id="evidencia">**Evidencia bajo control.** Usa datos, estudios, citas y casos identificables solo cuando estén disponibles y permitidos por el contexto aprobado o por placeholders resueltos. La memoria del modelo nunca reemplaza una política de evidencia explícita. Si falta respaldo verificable, usa razonamiento transparente, califica la afirmación o elimínala. No dejes marcadores genéricos en el manuscrito.</regla>

<regla id="atribucion">**Honestidad intelectual.** Nunca inventes autor, estudio, fecha, institución, estadística, cita ni caso real. Incluye atribución solo cuando sus detalles estén disponibles con precisión y sean relevantes. No inventes personajes con nombres propios para simular un caso.</regla>

<regla id="originalidad">**Originalidad conceptual.** No reproduzcas marcos con nombre propio, metáforas insignia, ejemplos característicos ni secuencias reconocibles de libros conocidos. Esto incluye material asociado con *Hábitos Atómicos*. Expresa la función mediante razonamiento y redacción propios. Originalidad no exige inventar una metáfora, un marco o un caso ficticio.</regla>

<regla id="precision">**Precisión léxica.** Usa palabras que añadan información. Elimina adjetivos huecos como "integral", "profundo", "innovador", "revolucionario" y "fascinante"; elimina muletillas como "realmente", "verdaderamente", "básicamente" y "simplemente". Si quitar una palabra no cambia el sentido, quítala.</regla>

<regla id="apertura">**Apertura relevante.** Entra directamente en problema, tensión, pregunta o promesa central. No uses saludos, anuncios de estructura ni escenas ficticias por defecto. Usa una escena solo cuando el prompt local o el contrato requieran narración y esa escena vaya a desarrollarse como recurso central.</regla>

<regla id="transiciones">**Continuidad conceptual.** Cada párrafo debe surgir lógicamente del anterior. Conecta causa, consecuencia, pregunta, decisión o progresión argumental. No fuerces la repetición mecánica de una palabra, imagen o pregunta en cada transición.</regla>

<regla id="reencuadres" critica="true">**Reencuadres afirmativos. PROHIBIDO.** No uses estructuras de contraste correctivo: "No es X, es Y", "No es X, sino Y", "X no es A, es B", ni fórmulas equivalentes. Reescribe la idea como afirmación directa.
❌ "No es falta de talento: es falta de práctica."
❌ "No fallan por falta de intención, sino porque el sistema es pesado."
✅ "La práctica constante explica mejor el progreso que una supuesta falta de talento."
✅ "Un proceso liviano aumenta la probabilidad de mantener una conducta."</regla>

</reglas>
</instrucciones>

<autorevision>
Antes de entregar, revisa en silencio:

<lista-verificacion>
1. ¿El idioma, audiencia, promesa, voz y guardrails coinciden con <editorial_context>? Si no existe, ¿mantienes los defaults?
2. ¿El fragmento cumple su prompt local sin intentar cubrir todo el chapter_contract?
3. ¿Aparece alguna estructura "No es X, es Y" o equivalente? Reescríbela.
4. ¿Cada ejemplo, caso, analogía, metáfora o escena es imprescindible? Elimina los ornamentales.
5. ¿Usaste más de un recurso ilustrativo central sin que el prompt exigiera una comparación? Consolídalos en uno.
6. ¿Inventaste un personaje con nombre propio o un caso presentado como real? Elimínalo o anonimízalo.
7. ¿Hay una afirmación factual sin evidencia disponible, razonamiento suficiente o calificación? Corrígela u omítela.
8. ¿La apertura anuncia contenido, usa contexto genérico o abre una escena que luego abandonas? Reescríbela.
9. ¿Las transiciones avanzan por lógica o dependen de ecos mecánicos? Corrige las mecánicas.
10. ¿Algún concepto, marco, metáfora, ejemplo o secuencia recuerda a un libro conocido, incluido *Hábitos Atómicos*? Sustitúyelo por razonamiento original.
11. ¿Quedan adjetivos huecos, muletillas, etiquetas XML o comentarios sobre el proceso? Elimínalos.
</lista-verificacion>

Repite la revisión hasta cumplir todos los puntos.
</autorevision>

<formato-salida>
Responde únicamente con el contenido de la sección. Sin títulos añadidos, etiquetas XML, análisis, notas ni introducciones meta.
</formato-salida>$prompt$,
  TRUE
);

COMMIT;
```

- [ ] **Step 4: Run migration test and verify GREEN**

Run:

```bash
rtk pnpm exec vitest run lib/__tests__/system-prompt-v5-migration.test.ts
```

Expected: 4 tests PASS, including byte-identical prompt assertion.

- [ ] **Step 5: Run both v5 suites together**

Run:

```bash
rtk pnpm exec vitest run lib/ai/__tests__/system-prompt-v5.test.ts lib/__tests__/system-prompt-v5-migration.test.ts
```

Expected: 9 tests PASS.

- [ ] **Step 6: Commit migration contract**

Run:

```bash
rtk git add supabase/migrations/20260714000001_add_system_prompt_v5.sql lib/__tests__/system-prompt-v5-migration.test.ts
rtk git commit -m "feat: seed system prompt v5"
```

Expected: one Conventional Commit containing only migration and parity test.

### Task 3: Verify complete change

**Files:**

- Inspect only: all files changed by Tasks 1–2

- [ ] **Step 1: Run focused regression tests**

Run:

```bash
rtk pnpm exec vitest run lib/ai/__tests__/system-prompt-v5.test.ts lib/__tests__/system-prompt-v5-migration.test.ts lib/ai/__tests__/completion.test.ts
```

Expected: all selected tests PASS with zero failures.

- [ ] **Step 2: Run complete automated gates**

Run each command separately:

```bash
rtk pnpm test
rtk pnpm typecheck
rtk pnpm lint
rtk pnpm build
```

Expected: all commands exit 0 in isolated worktree. If a failure reproduces from HEAD before v5 changes, record it as pre-existing; do not modify unrelated production code.

- [ ] **Step 3: Audit scope and whitespace**

Run:

```bash
rtk git status --short
rtk git diff --check HEAD~2..HEAD
rtk git diff --stat HEAD~2..HEAD
rtk git log -2 --oneline
```

Expected: only five planned files changed; no whitespace errors; two Conventional Commits present.

- [ ] **Step 4: Inspect final prompt invariants**

Run:

```bash
rtk rg -n "System Prompt v5|jerarquia_de_instrucciones|Profundidad antes que variedad|No inventes personajes con nombres propios" lib/ai supabase/migrations/20260714000001_add_system_prompt_v5.sql
rtk rg -n "\\{respaldo\\}|Para cada párrafo planeado, define el anclaje|crea un marco, metáfora o ejemplo propio" lib/ai/system-prompt-v5.ts supabase/migrations/20260714000001_add_system_prompt_v5.sql
```

Expected: first search finds TS constant, tests, and migration; second search returns no matches.

- [ ] **Step 5: Hand off branch**

Report branch `codex/feat-system-prompt-v5`, two commit hashes, verification outputs, and note that original conflicted checkout was not modified.
