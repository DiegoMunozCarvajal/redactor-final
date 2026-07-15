import postgres from "postgres";

export type MigrationClient = ReturnType<typeof postgres>;

export function getPendingMigrationFiles(
  files: readonly string[],
  trackedFiles: readonly string[],
): string[] {
  const tracked = new Set(trackedFiles);
  return files.filter((file) => !tracked.has(file));
}

export function unwrapOuterTransaction(content: string): string {
  const trimmed = content.trim();

  // Strip leading SQL comments so the BEGIN wrapper can be detected even when
  // the file opens with a comment block.
  const commentStripped = trimmed.replace(
    /^(?:\s*--[^\n]*\n)+(?=\s*BEGIN;)/i,
    "",
  );

  const match = commentStripped.match(/^BEGIN;\s*([\s\S]*?)\s*COMMIT;$/i);
  return match?.[1].trim() ?? trimmed;
}

export async function applyMigrationAtomically(
  sql: MigrationClient,
  filename: string,
  content: string,
): Promise<void> {
  const executableSql = unwrapOuterTransaction(content);

  await sql.begin(async (tx) => {
    await tx.unsafe(executableSql);
    await tx.unsafe("INSERT INTO _migrations (filename) VALUES ($1)", [
      filename,
    ]);
  });
}
