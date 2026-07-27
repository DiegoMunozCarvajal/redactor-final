import { describe, expect, it } from "vitest";
import {
  EMPTY_SOURCE_PROFILE_SET_HASH,
  canonicalJson,
  sha256Canonical,
  sha256Text,
} from "../hash";

describe("pipeline hashes", () => {
  it("sorts object keys recursively but preserves array order", () => {
    expect(canonicalJson({ z: 1, a: { y: 2, x: 3 }, list: [2, 1] })).toBe(
      '{"a":{"x":3,"y":2},"list":[2,1],"z":1}',
    );
  });

  it("uses one stable empty-profile hash", () => {
    // sha256 of "[]" (canonical JSON of an empty array)
    expect(sha256Text("[]")).toBe(EMPTY_SOURCE_PROFILE_SET_HASH);
    expect(sha256Canonical([])).toBe(EMPTY_SOURCE_PROFILE_SET_HASH);
  });

  it("produces valid 64-char hex digest", () => {
    const h = sha256Text("hello");
    expect(h).toHaveLength(64);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    // Known SHA-256 of "hello"
    expect(h).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
  });
});
