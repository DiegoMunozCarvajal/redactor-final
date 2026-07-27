# Legacy Read-Only Notices

## Summary

Add safety classification to project and template API GET responses, render read-only banners in the UI, and disable mutation controls for legacy content.

## API Changes

**`GET /api/projects/[id]`** adds `safety` field:

- `state`: `"clean_v2"` | `"source_free"` | `"legacy_read_only"`
- `reasonCode?: string`
- `replacementProjectId?: string`

Classification:

1. If a newer project's `supersedesProjectId` points to this project, then this project is `legacy_read_only` with `replacementProjectId`
2. If the latest generation metadata has `templateAuthorization` with `scope: "template"` and a valid `pipelineRunId`, then `clean_v2`
3. If `templateAuthorization` has `scope: "source-free"`, then `source_free`
4. If no `templateAuthorization` at all in any generation metadata, then `legacy_read_only`

**`GET /api/books/[id]`** adds `safety` field:

- `classification`: `"clean_v2"` | `"legacy_unverified"` | `"suspect"` | `"contaminated"`
- `replacementTemplateId?: string`

Classification:

1. If template has a pipeline run with `status: "clean"` and valid `compilerVersion`, then `clean_v2`
2. Check `originalityAssessments` linked via chapter generations for contamination/suspect decisions
3. Fallback: `legacy_unverified`

## UI Components

- `<ProjectSafetyBanner>`: renders nothing for `clean_v2`, info/alert with replacement link for others
- `<TemplateSafetyBanner>`: renders nothing for `clean_v2`, tiered alerts for legacy/suspect/contaminated
- Both use `shadcn/ui Alert` + `lucide-react` icons + `next/link`
- `GenerateChapterButton`: accept optional `safety` prop, disable when `legacy_read_only`
- `PlaceholderFillSection`: accept optional `safety` prop, hide fill controls when `legacy_read_only`

## Test Strategy

Pure component tests with `@testing-library/react` + `jsdom` environment. Test each safety state renders the correct alert variant, displays replacement links when available, and renders nothing for `clean_v2`.

## Implementation Order

1. Write failing tests
2. Project API safety field
3. Template API safety field
4. ProjectSafetyBanner component
5. TemplateSafetyBanner component
6. Integrate into project page
7. Integrate into template page
8. Disable mutation controls
9. Verify tests + typecheck
10. Commit
