import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadEnvFile } from "node:process";
import postgres from "postgres";

import {
  applyMigrationAtomically,
  getPendingMigrationFiles,
} from "./migration-runner";

const isLocal = process.argv.includes("--local");

const LOCAL_DB_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

let databaseUrl: string | undefined;

if (isLocal) {
  databaseUrl = LOCAL_DB_URL;
} else {
  // Remote: load .env.local (Next.js convention, created by vercel env pull)
  if (!process.env.DATABASE_URL && existsSync(".env.local")) loadEnvFile(".env.local");
  databaseUrl = process.env.DATABASE_URL;
}

if (!databaseUrl) {
  throw new Error(
    isLocal
      ? `Local DB not reachable. Is supabase running? Expected: ${LOCAL_DB_URL}`
      : "DATABASE_URL is required. Set it in .env.local or pass --local for local development.",
  );
}

console.log(`Using ${isLocal ? "local" : "remote"} database.`);

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
