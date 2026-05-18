import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadEnvFile } from "node:process";
import postgres from "postgres";

if (!process.env.DATABASE_URL && existsSync(".env")) {
  loadEnvFile(".env");
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const MIGRATIONS_DIR = join(import.meta.dirname, "..", "supabase", "migrations");

async function main() {
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const sql = postgres(databaseUrl!, { max: 1 });

  // Ensure migration tracking table exists
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS _migrations (
      filename text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  // If tracking table was just created (empty), backfill with all existing
  // files assuming they were already applied against a pre-existing DB.
  const [tracked] = await sql.unsafe(`SELECT count(*)::int AS count FROM _migrations`);
  if (tracked.count === 0 && files.length > 0) {
    console.log(
      "Migration tracking is new. Assuming existing migrations were already applied.",
    );
    for (const file of files) {
      await sql.unsafe(`INSERT INTO _migrations (filename) VALUES ($1)`, [file]);
    }
    console.log(`  Backfilled ${files.length} migration(s).`);
    await sql.end();
    console.log("No pending migrations.");
    return;
  }

  let applied = 0;
  let skipped = 0;

  for (const file of files) {
    const [already] = await sql.unsafe(
      `SELECT 1 FROM _migrations WHERE filename = $1`,
      [file],
    );
    if (already) {
      skipped++;
      continue;
    }

    const content = readFileSync(join(MIGRATIONS_DIR, file), "utf-8");
    console.log(`Applying ${file}...`);
    await sql.unsafe(content);
    await sql.unsafe(`INSERT INTO _migrations (filename) VALUES ($1)`, [file]);
    console.log(`  done`);
    applied++;
  }

  await sql.end();

  if (applied > 0 || skipped > 0) {
    console.log(
      `Migrations: ${applied} applied, ${skipped} skipped (already applied).`,
    );
  } else {
    console.log("No pending migrations.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
