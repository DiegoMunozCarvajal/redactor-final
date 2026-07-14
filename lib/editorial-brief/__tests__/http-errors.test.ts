import { describe, expect, it, vi } from "vitest";
import { mapRepoError } from "@/app/api/projects/[id]/editorial-briefs/map-repo-error";
import {
  EditorialBriefExpectedHashFormatError,
  EditorialBriefExpectedHashMismatchError,
  EditorialBriefIntegrityError,
} from "../errors";

describe("editorial brief repository HTTP errors", () => {
  it("maps storage corruption to a generic 500 without leaking details", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = mapRepoError(
      new EditorialBriefIntegrityError(
        "Composite expected abcdef but computed 123456 with JSON secret",
      ),
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "Editorial brief integrity verification failed",
    });
    expect(log).toHaveBeenCalledOnce();
    log.mockRestore();
  });

  it("maps a valid expected-hash mismatch to 409", async () => {
    const response = mapRepoError(
      new EditorialBriefExpectedHashMismatchError(),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "Editorial brief hash mismatch",
    });
  });

  it("maps an empty or malformed expected hash to stable 400", async () => {
    const response = mapRepoError(new EditorialBriefExpectedHashFormatError());

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "expectedHash must be a lowercase SHA-256 hash",
    });
  });
});
