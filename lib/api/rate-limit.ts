import { db, client } from "@/lib/db/drizzle";
import { chapterGenerations } from "@/lib/db/schema";
import { eq, and, gte, sql, inArray } from "drizzle-orm";

const WINDOW_SECONDS = 60;
const MAX_GENERATIONS_PER_WINDOW = 1;

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

  // Reserve a dedicated connection so the advisory lock binds to a distinct
  // PostgreSQL session. Without this, max:1 pools share a single session and
  // pg_try_advisory_lock is reentrant — two requests would both "acquire" it.
  //
  // Connection pool max is 3 (dev) / 2 (prod). Each concurrent lock attempt
  // reserves one connection. We must release it on ALL paths to avoid pool
  // exhaustion.
  const reserved = await client.reserve();

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
  const windowStart = new Date(Date.now() - WINDOW_SECONDS * 1000);

  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(chapterGenerations)
    .where(
      and(
        eq(chapterGenerations.projectId, projectId),
        gte(chapterGenerations.createdAt, windowStart),
        inArray(chapterGenerations.status, ["pending", "generating", "assembling"])
      )
    );

  const recentGenerations = row?.count ?? 0;

  if (recentGenerations >= MAX_GENERATIONS_PER_WINDOW) {
    return { allowed: false, retryAfter: WINDOW_SECONDS };
  }

  return { allowed: true };
}
