import { describe, expect, it } from "vitest";

import { runSettledWithConcurrency } from "@/lib/promise-pool";

describe("runSettledWithConcurrency", () => {
  it("limits active workers and preserves result order", async () => {
    let active = 0;
    let maxActive = 0;

    const results = await runSettledWithConcurrency([1, 2, 3, 4, 5], 2, async (item) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active--;
      return item * 2;
    });

    expect(maxActive).toBeLessThanOrEqual(2);
    expect(results.map((result) => result.status === "fulfilled" ? result.value : null)).toEqual([
      2,
      4,
      6,
      8,
      10,
    ]);
  });

  it("keeps running after a worker rejects", async () => {
    const results = await runSettledWithConcurrency([1, 2, 3], 2, async (item) => {
      if (item === 2) throw new Error("failed");
      return item;
    });

    expect(results.map((result) => result.status)).toEqual([
      "fulfilled",
      "rejected",
      "fulfilled",
    ]);
  });
});
