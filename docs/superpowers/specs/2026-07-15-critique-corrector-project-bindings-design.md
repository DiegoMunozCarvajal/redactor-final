# Critique and Corrector Project Binding Design

**Date:** 2026-07-15

## Goal

Make chapter critique and correction use the versioned prompt registry end to end. When a chapter page opens, both stages show their effective prompt revision. The global default is selected when the project has no override. Changing either selector persists an exact revision for the entire project.

## Current defect

The registry contains active `critique` and `corrector` definitions, revisions, and global defaults. The affected project has no project bindings, so both global defaults should resolve.

The chapter page still searches legacy project chapter prompts through `prompts.find(p => p.isCritique)` and `prompts.find(p => p.isCorrector)`. No such legacy rows exist after registry cutover, so both cards render as unconfigured. The page also posts inline legacy prompt content, while the critique and correction APIs now require `critiquePromptRevisionId` and `correctorPromptRevisionId`.

## Decision

Use the existing prompt registry and binding precedence:

1. project binding for the prompt kind;
2. global default for the prompt kind;
3. no effective prompt when neither exists.

Selections persist through `project_prompt_bindings`. Do not recreate or copy legacy chapter prompt rows.

## Data loading

Create a reusable client-side loader for the two review kinds: `critique` and `corrector`.

For each kind it loads:

- active definitions from `GET /api/prompt-definitions?kind=<kind>`;
- revisions for each definition from `GET /api/prompt-definitions/[id]/revisions`;
- project bindings from `GET /api/projects/[id]/prompt-bindings`.

The loader returns:

- effective revision with source `project-binding` or `global-default`;
- every selectable active revision with definition name and version label;
- the global default revision ID;
- the current project binding revision ID, when present.

Missing configured revisions, failed requests, or inconsistent registry data produce a visible load error. The UI does not silently fall back to legacy prompts.

## Chapter UI

The Critique and Corrector cards each show:

- prompt definition name and version;
- source badge: `Project binding` or `Global default`;
- revision selector;
- model selector;
- existing action button;
- loading, error, and retry states.

Selector behavior:

- Initial value is the project binding when one exists.
- Otherwise initial value is the global default.
- Selecting a revision calls `PUT /api/projects/[id]/prompt-bindings` with the matching kind and revision ID.
- Selecting `Use global default` calls `DELETE /api/projects/[id]/prompt-bindings?kind=<kind>`.
- The selector disables during mutation.
- Failed mutation keeps the previous effective selection and shows server error text.
- Successful mutation reloads canonical registry and binding data before confirming the new selection.

Prompt text remains read-only on the chapter page. Global editing stays in `/generation`.

## Execution flow

Critique execution sends:

- `critiquePromptRevisionId`: selected effective critique revision;
- selected model;
- existing content selection behavior.

Correction execution sends:

- `correctorPromptRevisionId`: selected effective corrector revision;
- selected critique generation ID;
- selected model;
- existing content selection behavior.

Both action buttons remain disabled until registry loading succeeds and an effective revision exists. API routes remain authoritative: they validate revision kind, executable status, and project ownership through existing runtime resolution.

The logic-only `CorrectorSection` receives the effective corrector revision ID instead of legacy prompt ID/content fields. Inline prompt payloads disappear from both flows.

## State and ownership

Prompt selection belongs to the project, not the chapter and not one execution. Changing it in any chapter updates every chapter in the project after refresh.

No new tables or migrations are required. Existing `project_prompt_bindings` already has primary key `(project_id, kind)` and stores exact revision IDs.

Past generations retain their recorded revision IDs. Changing a binding affects only future executions.

## Error handling

- Registry load failure: show inline error and retry; disable critique/correction action.
- Binding mutation failure: preserve previous selection; show actionable toast or inline error.
- No global default and no binding: show `No effective revision configured`; disable action.
- Bound revision unavailable or archived: surface configuration error; do not silently choose another revision.
- Execution API rejection: preserve current selection and show returned error.

## Testing strategy

### Loader tests

- project binding wins over global default;
- absent binding resolves global default;
- all active revisions remain selectable;
- missing effective revision returns a configuration error;
- failed registry or binding request returns load error.

### UI tests

- Critique and Corrector render global defaults on initial load.
- Existing project bindings render as selected.
- Changing selection issues the correct `PUT` payload and reloads canonical state.
- `Use global default` issues the correct `DELETE` request.
- Mutation failure restores previous value.
- Loading and error states disable actions.

### Execution tests

- critique request includes `critiquePromptRevisionId` and no inline `critiquePrompt` object;
- correction request includes `correctorPromptRevisionId` and no inline `correctorPrompt` object;
- changing a project binding changes the revision used by later runs;
- existing critique/correction API validation tests remain green.

### Verification

- focused component and route tests;
- full Vitest suite;
- TypeScript check;
- targeted ESLint;
- production build when implementation is complete.

## Rollout and compatibility

This is a forward-only UI cutover to registry data already present. No database migration or backfill is needed. Projects without bindings immediately inherit global defaults. Existing project bindings remain authoritative. Legacy critique/corrector chapter prompt rows, if any survive in old data, are ignored by these two runtime stages.

## Non-goals

- Editing prompt templates from the chapter page.
- Per-chapter prompt bindings.
- One-run prompt overrides.
- Changing critique selection or correction chaining rules.
- Changing model defaults.
