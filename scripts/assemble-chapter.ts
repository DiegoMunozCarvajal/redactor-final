// One-off: run assembly directly for a chapter.
// NOTE: generateChapterAssemblyHalves was removed in the prompt transparency
// migration. This script needs to be updated to use the planned assembly
// pipeline (runAssemblyPlanner + runAssemblyAssembler from lib/assembly/).
// Usage: export $(grep DATABASE_URL .env.local | xargs) && node --import tsx scripts/assemble-chapter.ts

import postgres from "postgres";
import { getChapterPlaceholders } from "../lib/placeholders";
import { loadEditorialBundle, snapshotFromBundle, metadataFromSnapshot, renderEditorialData } from "../lib/editorial-brief/context";

const CHAPTER_ID = "299a019c-2436-4a05-9b2f-d08118c5e2bf";
const PROJECT_ID = "d15fd234-0845-4d55-86e2-563565c128f9";

async function main() {
  const sql = postgres(process.env.DATABASE_URL!);

  console.log("Loading fragments from last assembly attempt...");

  // Get fragment IDs from the last failed assembly gen
  const [lastGen] = await sql`
    SELECT id, generation_metadata
    FROM chapter_generations
    WHERE chapter_id = ${CHAPTER_ID}
      AND project_id = ${PROJECT_ID}
      AND generation_metadata->>'type' = 'assembly'
      AND status = 'failed'
    ORDER BY created_at DESC LIMIT 1
  `;

  const meta = lastGen?.generation_metadata as Record<string, unknown> | null;
  const fragmentIds = meta?.fragmentIds as string[] | undefined;

  if (!fragmentIds?.length) {
    console.error("No failed assembly gen with fragmentIds found");
    await sql.end();
    process.exit(1);
  }

  console.log(`Found ${fragmentIds.length} fragments from gen ${lastGen.id}`);

  // Load fragments
  const frags = await sql`
    SELECT f.id, f.content, pp.title as prompt_title
    FROM fragments f
    LEFT JOIN prompts pp ON f.project_prompt_id = pp.id
    WHERE f.id = ANY(${sql.array(fragmentIds)}::uuid[])
    ORDER BY f.position
  `;

  if (frags.length !== fragmentIds.length) {
    console.error(`Found ${frags.length}/${fragmentIds.length} fragments`);
    await sql.end();
    process.exit(1);
  }

  const fragmentContents = frags.map((f) => ({
    title: (f.prompt_title ?? "Fragment") as string,
    content: (f.content ?? "") as string,
  }));

  // Load assembly prompt (project default)
  const [project] = await sql`
    SELECT assembly_prompt_id, topic FROM projects WHERE id = ${PROJECT_ID}
  `;

  if (!project.assembly_prompt_id) {
    console.error("No project assembly_prompt_id");
    await sql.end();
    process.exit(1);
  }

  const [assemblyPrompt] = await sql`
    SELECT content, user_prompt FROM prompt_library WHERE id = ${project.assembly_prompt_id}::uuid AND category = 'assembly'
  `;

  if (!assemblyPrompt) {
    console.error("No assembly prompt found");
    await sql.end();
    process.exit(1);
  }

  // Load placeholders
  const placeholders = await getChapterPlaceholders(CHAPTER_ID, project.topic);

  // Load current approved editorial brief for snapshot capture
  const briefBundle = await loadEditorialBundle({ projectId: PROJECT_ID });
  const briefSnapshot = briefBundle ? snapshotFromBundle(briefBundle) : null;
  const editorialContext = briefBundle
    ? renderEditorialData(briefBundle, { chapterId: CHAPTER_ID })
    : null;

  if (briefBundle) {
    console.log(`Using editorial brief v${briefBundle.version} (${briefBundle.hash.slice(0, 12)}...)`);
  }

  // Create generation record
  const [gen] = await sql`
    INSERT INTO chapter_generations (project_id, chapter_id, status, generation_metadata)
    VALUES (
      ${PROJECT_ID}::uuid, ${CHAPTER_ID}::uuid, 'assembling',
      ${JSON.stringify({
        type: "assembly",
        model: "deepseek-v4-pro",
        effort: "max",
        algorithm: "halves",
        fragmentIds,
        ...(briefSnapshot ? metadataFromSnapshot(briefSnapshot) : {}),
      })}::jsonb
    )
    RETURNING id
  `;

  console.log(`Created generation ${gen.id} — running assembly (halves algorithm)...`);
  console.log(`Fragments: ${fragmentContents.length}, total chars: ${fragmentContents.reduce((s, f) => s + f.content.length, 0)}`);

  try {
    console.error(
      "This script needs updating for the prompt transparency migration. " +
      "Use runAssemblyPlanner + runAssemblyAssembler from lib/assembly/ instead.",
    );
    await sql.end();
    process.exit(1);
  } catch (err) {
    console.error("Assembly failed:", err);
    const msg = err instanceof Error ? err.message : String(err);
    await sql`
      UPDATE chapter_generations
      SET status = 'failed', error = ${msg}
      WHERE id = ${gen.id}::uuid
    `;
    await sql.end();
    process.exit(1);
  }

  await sql.end();
  console.log("Done!");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
