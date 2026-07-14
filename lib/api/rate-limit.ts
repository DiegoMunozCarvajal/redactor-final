import { db } from "@/lib/db/drizzle";
import { lockClient } from "@/lib/db/lock-pool";
import { chapterGenerations } from "@/lib/db/schema";
import { eq, and, gte, sql, inArray, lt, type SQL } from "drizzle-orm";
import { STALE_TIMEOUT_MS } from "@/lib/constants";

// Re-export for backward compat — trigger tasks and API routes import this.
export { STALE_TIMEOUT_MS };

const MAX_GENERATIONS_PER_WINDOW = 1;

/**
 * Clean up stale generation rows for a given type before creating a new one.
 * Stale rows (stuck in pending/generating for >30min) block the rate limiter.
 *
 * Call inside withProjectLock for TOCTOU safety.
 */
export async function cleanupStaleGenerations(
  projectId: string,
  type: string,
  opts?: {
    chapterId?: string;
    statuses?: Array<"pending" | "generating" | "assembling" | "completed" | "failed" | "awaiting_assembly">;
    errorMessage?: string;
  },
): Promise<void> {
  const staleCutoff = new Date(Date.now() - STALE_TIMEOUT_MS);
  const conditions: SQL[] = [
    eq(chapterGenerations.projectId, projectId),
    inArray(chapterGenerations.status, opts?.statuses ?? ["pending", "generating", "assembling"]),
    sql`${chapterGenerations.generationMetadata}->>'type' = ${type}`,
    lt(chapterGenerations.createdAt, staleCutoff),
  ];
  if (opts?.chapterId) {
    conditions.push(eq(chapterGenerations.chapterId, opts.chapterId));
  }

  await db
    .update(chapterGenerations)
    .set({
      status: "failed",
      error: opts?.errorMessage ?? `Stale ${type} generation (timed out)`,
    })
    .where(and(...conditions));
}

function projectIdToLockKey(projectId: string): [number, number] {
  const hex = projectId.replace(/-/g, "");
  // 8 hex chars fits in 32 bits — safe within JS integer range
  const key1 = parseInt(hex.substring(0, 8), 16) | 0;
  const key2 = parseInt(hex.substring(8, 16), 16) | 0;
  return [key1, key2];
}

export async function withProjectLock<T>(
  projectId: string,
  fn: () => Promise<T>
): Promise<{ locked: false } | { locked: true; result: T }> {
  const [key1, key2] = projectIdToLockKey(projectId);

  // Reserve a connection from the dedicated lock pool so the advisory lock
  // binds to a distinct PostgreSQL session. The main application pool is
  // unaffected — lock operations never compete with normal DB queries.
  const reserved = await lockClient.reserve();

  try {
    const [row] = await reserved.unsafe(
      `SELECT pg_try_advisory_lock($1::int4, $2::int4) AS acquired`,
      [key1, key2]
    );

    if (!row.acquired) {
      return { locked: false };
    }

    try {
      const result = await fn();
      return { locked: true, result };
    } finally {
      await reserved
        .unsafe(`SELECT pg_advisory_unlock($1::int4, $2::int4)`, [key1, key2])
        .catch((err) => {
          console.error("[withProjectLock] Failed to release advisory lock:", err);
        });
    }
  } finally {
    reserved.release();
  }
}

export async function checkProjectRateLimit(
  projectId: string
): Promise<{ allowed: boolean; retryAfter?: number }> {
  const staleCutoff = new Date(Date.now() - STALE_TIMEOUT_MS);

  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(chapterGenerations)
    .where(
      and(
        eq(chapterGenerations.projectId, projectId),
        gte(chapterGenerations.createdAt, staleCutoff),
        inArray(chapterGenerations.status, ["pending", "generating", "assembling"])
      )
    );

  const recentGenerations = row?.count ?? 0;

  if (recentGenerations >= MAX_GENERATIONS_PER_WINDOW) {
    return { allowed: false, retryAfter: 15 };
  }

  return { allowed: true };
}
