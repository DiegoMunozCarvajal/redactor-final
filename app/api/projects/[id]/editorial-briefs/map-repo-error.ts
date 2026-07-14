import { NextResponse } from "next/server";
import { sanitizeError } from "@/lib/sanitize-error";
import {
  EditorialBriefExpectedHashFormatError,
  EditorialBriefExpectedHashMismatchError,
  EditorialBriefIntegrityError,
} from "@/lib/editorial-brief/errors";

export function mapRepoError(err: unknown): NextResponse {
  if (err instanceof EditorialBriefIntegrityError) {
    console.error(
      "[editorial-brief] Integrity verification failed:",
      sanitizeError(err),
    );
    return NextResponse.json(
      { error: "Editorial brief integrity verification failed" },
      { status: 500 },
    );
  }
  if (err instanceof EditorialBriefExpectedHashMismatchError) {
    return NextResponse.json({ error: err.message }, { status: 409 });
  }
  if (err instanceof EditorialBriefExpectedHashFormatError) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }

  const message = err instanceof Error ? err.message : "Unknown error";
  if (message.includes("not found") || message.includes("do not belong")) {
    return NextResponse.json({ error: message }, { status: 404 });
  }
  if (message.includes("non-draft") || message.includes("already exists")) {
    return NextResponse.json({ error: message }, { status: 409 });
  }
  if (
    message.includes("Invalid bundle") ||
    message.includes("exceeds maximum")
  ) {
    return NextResponse.json({ error: message }, { status: 400 });
  }
  return NextResponse.json({ error: sanitizeError(err) }, { status: 500 });
}
