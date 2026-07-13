import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { withTestDb, closeTestDb } from "./db";
import { projects } from "@/lib/db/schema";
import { sql } from "drizzle-orm";

/**
 * Verify that withTestDb provides rollback isolation.
 * A row inserted inside one callback must be absent in the next callback.
 */

// Use a shared deterministic user id for testing
const TEST_USER_ID = "00000000-0000-0000-0000-000000000001";

// Skip all DB-dependent tests if TEST_DATABASE_URL is not set
const describeDb = process.env.TEST_DATABASE_URL ? describe : describe.skip;

beforeAll(async () => {
  // Ensure the auth.users fixture exists if the FK constraint requires it.
  // The projects table references auth.users, but in tests the FK may not
  // be enforced if the auth schema is absent. If a FK error occurs, skip
  // these tests and document the missing fixture.
});

afterAll(async () => {
  await closeTestDb();
});

describeDb("withTestDb", () => {
  it("inserts a row inside the callback", async () => {
    await withTestDb(async (db) => {
      const [project] = await db
        .insert(projects)
        .values({
          userId: TEST_USER_ID,
          name: "Rollback Test Project",
        })
        .returning({ id: projects.id });

      expect(project).toBeDefined();
      expect(project.id).toBeTruthy();
    });
  });

  it("does not persist rows across callbacks (rollback isolation)", async () => {
    // Insert a row in the first callback
    const insertedId = await withTestDb(async (db) => {
      const [project] = await db
        .insert(projects)
        .values({
          userId: TEST_USER_ID,
          name: "Isolation Test Project",
        })
        .returning({ id: projects.id });

      return project.id;
    });

    // Verify the row is NOT visible in a second callback
    await withTestDb(async (db) => {
      const rows = await db
        .select({ id: projects.id })
        .from(projects)
        .where(sql`${projects.id} = ${insertedId}`);

      expect(rows).toHaveLength(0);
    });
  });

  it("allows multiple independent callbacks", async () => {
    const id1 = await withTestDb(async (db) => {
      const [p] = await db
        .insert(projects)
        .values({ userId: TEST_USER_ID, name: "Project A" })
        .returning({ id: projects.id });
      return p.id;
    });

    const id2 = await withTestDb(async (db) => {
      const [p] = await db
        .insert(projects)
        .values({ userId: TEST_USER_ID, name: "Project B" })
        .returning({ id: projects.id });
      return p.id;
    });

    // Neither ID should be visible now
    await withTestDb(async (db) => {
      const rows = await db
        .select({ id: projects.id })
        .from(projects)
        .where(sql`${projects.id} IN (${id1}, ${id2})`);

      expect(rows).toHaveLength(0);
    });
  });

  it("rethrows errors from the callback", async () => {
    await expect(
      withTestDb(async () => {
        throw new Error("expected error");
      }),
    ).rejects.toThrow("expected error");
  });

  it("returns the callback result", async () => {
    const result = await withTestDb(async () => {
      return 42;
    });
    expect(result).toBe(42);
  });
});
