/**
 * Test fixture factories for creating test data.
 *
 * Each factory returns the created row(s) so tests can assert on them.
 * All factories require a db instance (from withTestDb) — they don't
 * import the global db directly so they work within transactions.
 */

import type { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/lib/db/schema";

type TestDb = ReturnType<typeof drizzle<typeof schema>>;

const TEST_USER_ID = "00000000-0000-0000-0000-000000000000";

export async function createTestProject(
  db: TestDb,
  overrides: Partial<typeof schema.projects.$inferInsert> = {},
) {
  const [project] = await db
    .insert(schema.projects)
    .values({
      name: "Test Project",
      userId: TEST_USER_ID,
      ...overrides,
    })
    .returning();
  return project;
}

export async function createTestChapter(
  db: TestDb,
  projectId: string,
  overrides: Partial<typeof schema.chapters.$inferInsert> = {},
) {
  const [chapter] = await db
    .insert(schema.chapters)
    .values({
      projectId,
      title: "Test Chapter",
      position: 1,
      ...overrides,
    })
    .returning();
  return chapter;
}

export async function createTestChapterGeneration(
  db: TestDb,
  projectId: string,
  chapterId: string,
  overrides: Partial<typeof schema.chapterGenerations.$inferInsert> = {},
) {
  const [gen] = await db
    .insert(schema.chapterGenerations)
    .values({
      projectId,
      chapterId,
      status: "pending",
      ...overrides,
    })
    .returning();
  return gen;
}
