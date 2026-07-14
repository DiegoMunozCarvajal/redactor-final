import { NextResponse } from "next/server";
import {
  EditorialBriefChapterCoverageError,
  EditorialBriefExpectedHashFormatError,
  EditorialBriefExpectedHashMismatchError,
  EditorialBriefIntegrityError,
} from "@/lib/editorial-brief/errors";

export function mapRepoError(err: unknown): NextResponse {
  if (err instanceof EditorialBriefChapterCoverageError) {
    return NextResponse.json(
      {
        error: "Editorial brief chapter coverage does not match current project chapters",
        code: "editorial_brief_chapter_coverage_mismatch",
      },
      { status: 409 },
    );
  }

  if (err instanceof EditorialBriefIntegrityError) {
    console.error(err);
    return NextResponse.json(
      { error: "Editorial brief integrity verification failed" },
      { status: 500 },
    );
  }

  if (err instanceof EditorialBriefExpectedHashMismatchError) {
    return NextResponse.json(
      { error: "Editorial brief hash mismatch" },
      { status: 409 },
    );
  }

  if (err instanceof EditorialBriefExpectedHashFormatError) {
    return NextResponse.json(
      { error: "expectedHash must be a lowercase SHA-256 hash" },
      { status: 400 },
    );
  }

  const message = err instanceof Error ? err.message : "Unknown error";
  if (message.includes("not found")) {
    return NextResponse.json({ error: message }, { status: 404 });
  }
  if (message.includes("non-draft") || message.includes("already exists")) {
    return NextResponse.json({ error: message }, { status: 409 });
  }
  if (message.includes("Invalid bundle") || message.includes("exceeds maximum")) {
    return NextResponse.json({ error: message }, { status: 400 });
  }

  if (err instanceof Error) console.error(err);
  return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
}
