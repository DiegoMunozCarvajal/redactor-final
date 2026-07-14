import { describe, expect, it, vi } from "vitest";

import {
  applyMigrationAtomically,
  getPendingMigrationFiles,
  unwrapOuterTransaction,
  type MigrationClient,
} from "../migration-runner";

describe("migration runner", () => {
  it("treats every file as pending when tracking is empty", () => {
    expect(getPendingMigrationFiles(["001.sql", "002.sql"], [])).toEqual([
      "001.sql",
      "002.sql",
    ]);
  });

  it("filters only exact tracked filenames", () => {
    expect(
      getPendingMigrationFiles(
        ["20260623170735_unique.sql", "20260623215908_unique.sql"],
        ["20260623170735_unique.sql"],
      ),
    ).toEqual(["20260623215908_unique.sql"]);
  });

  it("unwraps a migration-owned outer transaction", () => {
    expect(unwrapOuterTransaction("BEGIN;\nSELECT 1;\nCOMMIT;\n")).toBe(
      "SELECT 1;",
    );
    expect(unwrapOuterTransaction("DO $$ BEGIN NULL; END $$;")).toBe(
      "DO $$ BEGIN NULL; END $$;",
    );
  });

  it("executes SQL and tracking insert inside one transaction", async () => {
    const events: string[] = [];
    const client = {
      begin: vi.fn(async (callback) => {
        events.push("begin");
        await callback({
          unsafe: vi.fn(async (query: string, params?: unknown[]) => {
            events.push(params ? `track:${String(params[0])}` : `sql:${query}`);
          }),
        });
        events.push("commit");
      }),
    } as unknown as MigrationClient;

    await applyMigrationAtomically(
      client,
      "001.sql",
      "BEGIN;\nSELECT 1;\nCOMMIT;",
    );

    expect(events).toEqual([
      "begin",
      "sql:SELECT 1;",
      "track:001.sql",
      "commit",
    ]);
  });

  it("does not track a migration whose SQL fails", async () => {
    const tracked = vi.fn();
    const client = {
      begin: vi.fn(async (callback) =>
        callback({
          unsafe: vi.fn(async (_query: string, params?: unknown[]) => {
            if (params) tracked();
            else throw new Error("migration failed");
          }),
        }),
      ),
    } as unknown as MigrationClient;

    await expect(
      applyMigrationAtomically(client, "001.sql", "SELECT broken"),
    ).rejects.toThrow("migration failed");
    expect(tracked).not.toHaveBeenCalled();
  });
});
