import { NextResponse } from "next/server";

export function legacyPromptGone() {
  return NextResponse.json(
    {
      error: "Legacy prompt endpoint has been retired",
      replacement: "/generation",
    },
    { status: 410 },
  );
}
