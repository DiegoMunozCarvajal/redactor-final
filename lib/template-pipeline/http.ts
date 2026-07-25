import { NextResponse } from "next/server";
import { GenerationBlockedError } from "./contracts";

export function generationBlockedResponse(
  error: unknown,
): NextResponse | null {
  if (!(error instanceof GenerationBlockedError)) return null;
  return NextResponse.json(
    {
      error: "generation blocked",
      code: error.reason,
    },
    { status: 409 },
  );
}
