# System Prompt v5 Design

**Date:** 2026-07-14

## Goal

Create `System Prompt v5` as conservative evolution of current live v4. Preserve proven nonfiction-writing constraints while making approved `EditorialBrief` authoritative and eliminating prompt pressure that produces excessive examples, metaphors, micro-scenarios, and invented named characters.

## Current behavior and rationale

Current v4 uses five layers for distinct purposes:

1. `rol` establishes default manuscript language, reader sophistication, and editorial posture.
2. `planificacion` makes model choose one idea, an opening, explanatory support, and affirmative framing before drafting.
3. `reglas` states observable writing constraints with concrete positive and negative examples.
4. `autorevision` repeats high-risk constraints after drafting, when model can inspect its own output.
5. `formato-salida` prevents analysis, XML, and other meta-text from leaking into manuscript.

These layers remain. Live DB v4 also contains later tuning absent from original migration: stronger openings, `{respaldo}` fallback, and explicit protection against reproducing _Hábitos Atómicos_. V5 uses live v4—not historical migration text—as semantic baseline.

## Diagnosed failure

V4 requests illustrative material in several overlapping places:

- planning requires an anchor for every planned paragraph;
- `respaldo` requires an example, analogy, datum, reasoning, or source after every non-obvious claim;
- `concreto` requires immediate illustration of every abstraction;
- `originalidad` tells model to create frameworks, metaphors, or examples;
- opening guidance offers fictional scenes as a normal hook;
- self-review adds missing anchors again.

This repetition makes illustration default behavior. A conservative audit of 23 fragments generated after current v4 update found explicit example/analogy cues in 11 fragments: six uses of “imagina,” five of “como si,” plus invented names including Carlos, Marcos, Elena, María, and Lucas. Heuristic undercounts implicit examples, so finding is directional rather than exhaustive.

## Decision

V5 becomes default global system prompt. Project-specific prompt overrides remain untouched. Without approved editorial context, v5 preserves Spanish, curious non-expert reader, close precise tone, and all stable v4 quality rules. With approved context, variable editorial constraints override defaults.

V5 will be additive and surgical. It will not become a duplicate of `EditorialBrief`, and it will not move niche-specific content into global prompt.

## Instruction hierarchy

V5 adds explicit hierarchy near top:

1. Approved `<editorial_context>` controls manuscript language, audience, promise, voice, guardrails, evidence policy, and chapter contract.
2. Local content prompt controls fragment-specific narrative job.
3. V5 controls invariant craft and integrity: clarity, honesty, originality, precision, affirmative framing, continuity, and output cleanliness.
4. If editorial context omits a variable detail, v5 default applies.
5. If no editorial context exists, legacy v4 defaults apply.

Chapter contract constrains fragment but is not checklist every fragment must cover. Fragment executes local prompt and contributes only relevant portion of chapter contract.

## Illustration policy

Remove current `{respaldo}` fallback and replace paragraph-level anchoring with depth-first policy:

> **Profundidad antes que variedad.** Desarrolla ideas mediante explicación causal, razonamiento y consecuencias concretas. No añadas ejemplos, casos, analogías ni metáforas por rutina. Úsalos solo cuando el prompt local, el contrato editorial o la dificultad del concepto los hagan necesarios. Cuando uses uno, elige un único recurso central y desarróllalo con suficiente profundidad. No encadenes microejemplos ni inventes personajes con nombres propios.

Supporting changes:

- planning asks whether illustration is necessary; default answer is no;
- if necessary, select one central device for fragment;
- `concreto` means explain mechanism, consequence, decision, or application—not automatically invent scene;
- `originalidad` means original reasoning and expression; it does not require novel metaphor, framework, or fictional case;
- opening enters problem, tension, question, or promise directly; fictional vignette only when local prompt or contract requests narrative;
- transitions preserve conceptual continuity; no mandatory word/image echo each paragraph;
- invented personal names prohibited unless supplied by approved source or explicitly required;
- multiple small examples cannot substitute for one developed explanation.

## Evidence policy

V5 never creates generic `{respaldo}` marker.

- When approved context or resolved placeholders provide evidence, use only evidence relevant to local claim and respect its citation policy.
- When evidence is unavailable, support claim through transparent reasoning, qualify it, or omit it.
- Never invent author, study, date, institution, statistic, quotation, or named case.
- Model memory cannot override explicit brief evidence constraints.

## Preserved v4 constraints

V5 preserves:

- one idea per paragraph;
- active voice;
- varied sentence rhythm;
- lexical precision and removal of empty adjectives/filler;
- strong non-meta openings;
- intellectual honesty;
- conceptual originality and protection against recognizable material from known books, including _Hábitos Atómicos_;
- prohibition of corrective contrast structures;
- silent planning and self-review;
- manuscript-only output.

## Self-review changes

Self-review keeps v4 checks and adds:

1. output follows approved manuscript language, audience, voice, and guardrails;
2. fragment fulfills local prompt without attempting entire chapter contract;
3. every illustration is necessary;
4. fragment uses at most one central illustrative device unless local prompt explicitly requires comparison;
5. no invented named character appears;
6. no cluster of microexamples, mixed metaphors, or unsupported factual claims appears.

## Persistence and fallback

Implementation will:

- add immutable migration `20260714000001_add_system_prompt_v5.sql` inserting `System Prompt v5`;
- unset previous default and make v5 default;
- retain all previous prompt rows;
- update hardcoded `DEFAULT_SYSTEM_PROMPT` to same v5 semantics so DB and fallback do not diverge;
- leave projects with explicit `generationSystemPromptId` unchanged.

## Testing

TDD sequence:

1. Add failing test asserting v5 migration/fallback does not exist.
2. Assert v5 becomes default without deleting v4.
3. Assert hierarchy covers all `EditorialBrief` variable fields.
4. Assert critical v4 rule ids and output contract remain.
5. Assert removed behavior is absent: generic `{respaldo}`, anchor-per-paragraph mandate, routine illustration, and permission to invent named characters.
6. Assert new depth-first illustration and missing-evidence behavior exist in migration and fallback.
7. Run focused prompt tests, full tests, typecheck, lint, and build. Record failures caused by pre-existing unresolved conflicts separately; do not modify those conflicting files in this change.

## Non-goals

- No changes to MetaPrompt, assembly, critique, or corrector prompts.
- No changes to `EditorialBrief` schema or scope renderer.
- No automatic reassignment of projects pinned to older system prompts.
- No provider calls or subjective A/B generation evaluation in this change.

## Success criteria

- V5 is selectable and default for projects without explicit override.
- No-brief projects retain intended v4 language, reader, tone, integrity, and formatting behavior.
- Brief-aware generation has unambiguous precedence.
- Prompt no longer demands an anchor or illustration for every paragraph.
- Prompt prefers zero illustrative devices by default and one developed device when needed.
- Prompt forbids invented named characters and unsupported evidence.
- Migration and hardcoded fallback express same behavioral contract.
