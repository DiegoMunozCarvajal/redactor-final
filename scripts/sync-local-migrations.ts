import { readdirSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

const LOCAL_DB_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const MIGRATIONS_DIR = join(import.meta.dirname, "..", "supabase", "migrations");

async function main() {
  const sql = postgres(LOCAL_DB_URL, { max: 1 });

  try {
    // Ensure tracking table exists
    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS _migrations (
        filename text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    const tracked = await sql<{ filename: string }[]>`
      SELECT filename FROM _migrations
    `;
    const trackedSet = new Set(tracked.map((r) => r.filename));

    let synced = 0;
    for (const file of files) {
      if (!trackedSet.has(file)) {
        await sql.unsafe("INSERT INTO _migrations (filename) VALUES ($1)", [
          file,
        ]);
        synced++;
      }
    }

    console.log(
      synced > 0
        ? `Synced ${synced} migration(s) to _migrations tracking table.`
        : "Migration tracking already in sync.",
    );
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
