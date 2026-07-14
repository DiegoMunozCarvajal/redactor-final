import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadEnvFile } from "node:process";
import postgres from "postgres";

import {
  applyMigrationAtomically,
  getPendingMigrationFiles,
} from "./migration-runner";

if (!process.env.DATABASE_URL && existsSync(".env")) {
  loadEnvFile(".env");
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const MIGRATIONS_DIR = join(import.meta.dirname, "..", "supabase", "migrations");

async function main() {
  const sql = postgres(databaseUrl!, { max: 1 });

  try {
    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS _migrations (
        filename text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const files = readdirSync(MIGRATIONS_DIR)
      .filter((file) => file.endsWith(".sql"))
      .sort();
    const trackedRows = await sql<{ filename: string }[]>`
      SELECT filename FROM _migrations
    `;
    const pendingFiles = getPendingMigrationFiles(
      files,
      trackedRows.map(({ filename }) => filename),
    );

    for (const file of pendingFiles) {
      const content = readFileSync(join(MIGRATIONS_DIR, file), "utf-8");
      console.log(`Applying ${file}...`);
      await applyMigrationAtomically(sql, file, content);
      console.log("  done");
    }

    const applied = pendingFiles.length;
    const skipped = files.length - applied;
    if (applied > 0 || skipped > 0) {
      console.log(
        `Migrations: ${applied} applied, ${skipped} skipped (already applied).`,
      );
    } else {
      console.log("No pending migrations.");
    }
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
