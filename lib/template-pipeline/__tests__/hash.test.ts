import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  EMPTY_SOURCE_PROFILE_SET_HASH,
  canonicalJson,
  sha256Canonical,
} from "../hash";

describe("pipeline hashes", () => {
  it("sorts object keys recursively but preserves array order", () => {
    expect(canonicalJson({ z: 1, a: { y: 2, x: 3 }, list: [2, 1] })).toBe(
      '{"a":{"x":3,"y":2},"list":[2,1],"z":1}',
    );
  });

  it("uses one stable empty-profile hash", () => {
    expect(EMPTY_SOURCE_PROFILE_SET_HASH).toBe(
      createHash("sha256").update("[]").digest("hex"),
    );
    expect(sha256Canonical([])).toBe(EMPTY_SOURCE_PROFILE_SET_HASH);
  });
});
