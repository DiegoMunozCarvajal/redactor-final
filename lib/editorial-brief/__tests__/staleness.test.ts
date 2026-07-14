import { describe, it, expect } from "vitest";
import { computeStaleness } from "../staleness";

const ACTIVE_BRIEF = {
  id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  version: 2,
  hash: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
};

const DIFFERENT_HASH =
  "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";

describe("computeStaleness", () => {
  // -------------------------------------------------------------------
  // State 1: No active brief + no gen snapshot → "current"
  // -------------------------------------------------------------------
  it("returns current when no active brief and no gen snapshot (legacy project)", () => {
    expect(computeStaleness(null, null)).toBe("current");
    expect(computeStaleness(undefined, null)).toBe("current");
    expect(computeStaleness({}, null)).toBe("current");
  });

  // -------------------------------------------------------------------
  // State 2: No active brief + has gen snapshot → "invalid" (brief deleted)
  // -------------------------------------------------------------------
  it("returns invalid when no active brief but generation has snapshot (brief deleted)", () => {
    const snapshot = {
      editorialBriefId: "dddddddd-dddd-dddd-dddd-dddddddddddd",
      editorialBriefVersion: 1,
      editorialBriefHash: DIFFERENT_HASH,
    };
    expect(computeStaleness(snapshot, null)).toBe("invalid");
  });

  // -------------------------------------------------------------------
  // State 3: Active brief + no gen snapshot → "legacy"
  // -------------------------------------------------------------------
  it("returns legacy when active brief exists but generation has no snapshot (pre-briefs gen)", () => {
    expect(computeStaleness(null, ACTIVE_BRIEF)).toBe("legacy");
    expect(computeStaleness(undefined, ACTIVE_BRIEF)).toBe("legacy");
    expect(computeStaleness({}, ACTIVE_BRIEF)).toBe("legacy");
  });

  // -------------------------------------------------------------------
  // State 4: Active brief + matching hash → "current"
  // -------------------------------------------------------------------
  it("returns current when gen snapshot matches active brief hash", () => {
    const snapshot = {
      editorialBriefId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      editorialBriefVersion: 2,
      editorialBriefHash: ACTIVE_BRIEF.hash,
    };
    expect(computeStaleness(snapshot, ACTIVE_BRIEF)).toBe("current");
  });

  // -------------------------------------------------------------------
  // State 5: Active brief + different hash → "stale"
  // -------------------------------------------------------------------
  it("returns stale when gen snapshot hash differs from active brief hash", () => {
    const snapshot = {
      editorialBriefId: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
      editorialBriefVersion: 1,
      editorialBriefHash: DIFFERENT_HASH,
    };
    expect(computeStaleness(snapshot, ACTIVE_BRIEF)).toBe("stale");
  });

  // -------------------------------------------------------------------
  // Edge cases: partial snapshot fields
  // -------------------------------------------------------------------
  it("returns legacy for partially null snapshot when active brief exists", () => {
    expect(
      computeStaleness(
        {
          editorialBriefId: "f",
          editorialBriefVersion: null,
          editorialBriefHash: null,
        },
        ACTIVE_BRIEF,
      ),
    ).toBe("legacy");

    expect(
      computeStaleness(
        {
          editorialBriefId: null,
          editorialBriefVersion: 1,
          editorialBriefHash: DIFFERENT_HASH,
        },
        ACTIVE_BRIEF,
      ),
    ).toBe("stale");

    expect(
      computeStaleness(
        {
          editorialBriefId: "f",
          editorialBriefVersion: 1,
          editorialBriefHash: null,
        },
        ACTIVE_BRIEF,
      ),
    ).toBe("legacy");
  });

  it("returns current for partially null snapshot when no active brief (no hash = no snapshot)", () => {
    expect(
      computeStaleness(
        {
          editorialBriefId: "f",
          editorialBriefVersion: null,
          editorialBriefHash: null,
        },
        null,
      ),
    ).toBe("current");

    expect(
      computeStaleness(
        {
          editorialBriefId: "f",
          editorialBriefVersion: 1,
          editorialBriefHash: null,
        },
        null,
      ),
    ).toBe("current");
  });

  it("returns invalid when hash present but no active brief (brief deleted)", () => {
    expect(
      computeStaleness(
        {
          editorialBriefId: "f",
          editorialBriefVersion: 1,
          editorialBriefHash: DIFFERENT_HASH,
        },
        null,
      ),
    ).toBe("invalid");
  });
});
