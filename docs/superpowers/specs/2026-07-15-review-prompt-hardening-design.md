# Review Prompt Hardening Design

**Date:** 2026-07-15

**Status:** Approved for implementation planning

## Goal

Complete EditorialBrief authority across review and assembly without rebuilding the generation chain. Add executable Critique v2 and Corrector v2 contracts, remove the remaining language conflict from assembly, prevent untrusted runtime data from breaking prompt framing, and eliminate the unused hidden system-prompt path.

## Current State

- EditorialBrief data reaches fragment, planner, assembly, critique, correction, title, placeholder-fill, and extraction stages.
- System Prompt v5 and Assembly v1.3 are active defaults.
- Critique and Corrector active defaults remain version 1.0.
- Critique 1.0 mentions editorial criteria but does not emit a machine-consumable status contract.
- Corrector 1.0 cannot prove that every editorial failure was resolved.
- Final composed `system` and `user` messages are stored in `llm_prompt_executions.messages`.
- `generateCompletion` still accepts `cachedSystemPrompt`, which could prepend system text outside executor logging if a future caller used it.
- Several untrusted text markers are inserted without stage-specific escaping.

## Non-Goals

- Do not recreate MetaPrompt v2.0.
- Do not rewrite content prompts.
- Do not change EditorialBrief extraction semantics.
- Do not replace the planned assembly pipeline.
- Do not convert critique output to JSON or require a new chapter-page renderer.
- Do not overwrite explicit project prompt bindings.

## Approach

Use immutable prompt-registry revisions and XML output contracts. XML remains readable in the current UI and gives Corrector v2 stable fields without requiring structured-output plumbing or a new frontend representation.

Create one migration containing:

- Critique revision 2.0 and default update.
- Corrector revision 2.0 and default update.
- Assembly revision 1.4 and default update.

Existing runs keep their persisted revision IDs. New runs resolve the new global defaults unless a project has an explicit binding.

## Critique v2 Contract

Critique v2 treats EditorialBrief and the chapter contract as approved authority. Chapter content remains untrusted data. It diagnoses; it never rewrites the chapter.

Output must contain one root element and no surrounding prose:

```xml
<critica version="2.0">
  <resumen_priorizado>...</resumen_priorizado>
  <criterios_editoriales>
    <criterio id="audiencia">
      <estado>pass|partial|fail</estado>
      <evidencia>Pasaje breve o descripción localizable.</evidencia>
      <impacto>Efecto editorial concreto.</impacto>
      <correccion_requerida>Acción concreta; "ninguna" solo para pass.</correccion_requerida>
    </criterio>
    <criterio id="promesa">...</criterio>
    <criterio id="contrato_capitulo">...</criterio>
    <criterio id="voz">...</criterio>
    <criterio id="guardrails">...</criterio>
    <criterio id="evidencia">...</criterio>
  </criterios_editoriales>
  <calidad_tradicional>
    <hallazgo prioridad="alta|media|baja">
      <dimension>coherencia|claridad|continuidad|estructura|lenguaje</dimension>
      <evidencia>...</evidencia>
      <impacto>...</impacto>
      <correccion_requerida>...</correccion_requerida>
    </hallazgo>
  </calidad_tradicional>
</critica>
```

Rules:

- Emit exactly six editorial criteria with the IDs above.
- `pass` requires positive evidence and `correccion_requerida` equal to `ninguna`.
- `partial` and `fail` require localizable evidence, concrete impact, and actionable correction.
- `contrato_capitulo` evaluates reader shift, `mustCover`, required scenarios, overlap limits, and transition requirements as applicable.
- `guardrails` evaluates ethical principles, forbidden claims, and forbidden framing.
- `evidencia` evaluates factual support and citation policy without inventing missing sources.
- Traditional findings cover craft defects not already captured by the six editorial criteria.
- Avoid duplicate findings across sections.

## Corrector v2 Contract

Corrector v2 consumes Critique v2 XML plus the exact EditorialBrief snapshot and source chapter. Authority order:

1. EditorialBrief and chapter contract.
2. Mandatory critique corrections.
3. Source chapter material.
4. General model knowledge only for linguistic clarity, never new facts.

Rules:

- Resolve every editorial criterion marked `partial` or `fail`.
- Apply every traditional finding with a non-empty `correccion_requerida`, prioritizing high before medium before low.
- Preserve correct material, voice, qualifications, evidence, and factual ceiling.
- Reorder, condense, connect, or rewrite when required; minimal surgery is not an overriding constraint.
- Never invent facts, evidence, cases, people, mechanisms, statistics, or sources.
- If a requested correction requires unavailable evidence, narrow or remove the unsupported claim and record that decision.

Output keeps existing UI compatibility:

```xml
<capitulo_corregido>
  Prosa final del capítulo.
  <correcciones>
    <correccion>
      <antes>...</antes>
      <despues>...</despues>
      <hallazgo>...</hallazgo>
      <motivo>...</motivo>
    </correccion>
  </correcciones>
</capitulo_corregido>
```

Each mandatory `partial` or `fail` must map to at least one `<correccion>` entry. Several edits may satisfy one finding, and one coherent edit may satisfy several findings when `<hallazgo>` names each one.

## Assembly v1.4

Assembly v1.4 preserves v1.3 planning, factual ceiling, synthesis permissions, and source hierarchy. Change language authority only:

- Remove unconditional “en español” from role.
- Editorial context controls `manuscriptLanguage` when present.
- Spanish remains fallback only when no approved editorial context exists.
- Keep fragments as sole factual source and plan as structural guidance.

No numeric section quota is introduced. Planner and assembler continue accepting the number of content units produced by MetaPrompt v2.0.

## Runtime Data Framing

Registry templates remain the only source of editorial instructions. Runtime marker values are data and must not be able to close XML-like framing or inject sibling instruction blocks.

Add one shared text-data serializer that escapes `&`, `<`, and `>` after control-character sanitization. Apply it only to plain untrusted text markers and dynamic placeholder values:

- Critique chapter content.
- Correction chapter content.
- Correction critique content.
- Title project topic.
- Meta-template chapter source.
- Dynamic chapter placeholder definitions and project topic fallback.

Do not double-escape already structured serializers:

- `renderEditorialData` output.
- Assembly fragment XML.
- Assembly plan JSON.
- Placeholder context/research JSON.
- Editorial extraction chapter-context JSON and already escaped research document.
- Generated output-schema JSON.

The final escaped values remain visible in `llm_prompt_executions.messages`.

## Hidden System Context Removal

Remove `cachedSystemPrompt` from `CompletionOptions`, provider dispatch, and Anthropic system-message construction. Current production callers do not use it, so removal changes no intended prompt behavior.

Prompt caching may only operate on the resolved, logged registry system message. No API may prepend another system block after execution logging.

Add a source-level regression test that fails if `cachedSystemPrompt` reappears in production prompt code.

## Technical Payload Boundary

Generated JSON schemas, XML/JSON serializers, validation feedback, model settings, and technical post-generation guards are technical payloads, not editorial instructions.

They may remain in code when runtime-derived, provided that:

- Exact schema or feedback text sent to the model appears in stored final messages.
- `technicalPolicies` records non-prompt checks such as originality and echo guards.
- No technical helper adds natural-language editorial rules after prompt composition.

## Migration and Rollout

The migration inserts deterministic immutable revisions and updates only global defaults for `critique`, `corrector`, and `assembly`.

- Explicit `project_prompt_bindings` remain untouched.
- Projects without bindings receive new defaults on their next run.
- Existing queued critique/correction runs retain revision IDs already stored in generation metadata.
- Existing assembly runs retain persisted planner/assembly revision IDs.
- Imported legacy definitions remain archived or non-default; they are not deleted.

## Failure Handling

- Critique output remains plain model text. Corrector prompt must tolerate minor whitespace but requires the declared XML fields semantically.
- Correction output keeps current fallback behavior when outer XML is malformed, but tests must cover valid v2 output.
- Marker escaping must be deterministic and applied exactly once at each plain-text call site; tests must reject accidental double-escaping.
- Missing prompt revisions continue failing closed through `resolvePromptRevision`.

## Tests

Follow red-green-refactor for every behavior change.

Required coverage:

1. Migration test proves Critique 2.0, Corrector 2.0, and Assembly 1.4 revisions exist and become global defaults.
2. Migration test proves explicit project bindings are not updated.
3. Prompt contract test proves Critique v2 contains all six criterion IDs, `pass|partial|fail`, evidence, impact, and required correction fields.
4. Prompt contract test proves Corrector v2 resolves every `partial|fail` and preserves existing correction XML.
5. Assembly test proves editorial language authority and Spanish fallback.
6. Critique/correction execution tests prove untrusted closing tags are escaped in final stored messages.
7. Title/meta-template tests prove plain-text marker escaping.
8. Chapter prompt tests prove dynamic placeholders cannot close their wrappers or inject XML tags.
9. Transparency test proves `cachedSystemPrompt` is absent and only executors call `generateCompletion`.
10. Full typecheck, focused tests, full Vitest suite, and production build run before completion.

## Acceptance Criteria

- DB global defaults resolve Critique 2.0, Corrector 2.0, Assembly 1.4, and System Prompt v5.
- Critique v2 always requests six explicit editorial statuses and actionable evidence.
- Corrector v2 explicitly resolves all editorial `partial|fail` findings.
- Assembly obeys non-Spanish `manuscriptLanguage` when supplied and defaults to Spanish only without a brief.
- No production code path can prepend unlogged system text.
- Plain untrusted marker values cannot break XML-like prompt framing.
- Existing MetaPrompt v2.0 and content prompt snapshots remain unchanged.
- Existing explicit project bindings remain unchanged.
