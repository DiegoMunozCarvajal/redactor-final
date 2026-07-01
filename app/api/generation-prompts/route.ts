import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { generationSystemPrompts } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { csrfCheck } from "@/lib/api/csrf";
import { eq, desc } from "drizzle-orm";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const rows = await db
    .select()
    .from(generationSystemPrompts)
    .orderBy(desc(generationSystemPrompts.createdAt));

  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const csrfErr = csrfCheck(req);
  if (csrfErr) return csrfErr;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));

  // Type validation — prevent .trim() TypeError on non-strings
  if (typeof body.name !== "string" || typeof body.content !== "string") {
    return NextResponse.json(
      { error: "name and content must be strings" },
      { status: 400 },
    );
  }

  const name = body.name.trim();
  const description =
    typeof body.description === "string" ? body.description.trim() || null : null;
  const content = body.content.trim();
  const isDefault = body.is_default === true;

  if (!name || !content) {
    return NextResponse.json(
      { error: "name and content required" },
      { status: 400 },
    );
  }

  if (isDefault) {
    // Transaction with FOR UPDATE prevents race condition:
    // two concurrent POSTs with isDefault=true → only one becomes default.
    // The unique partial index catches any edge case the transaction misses.
    try {
      const [row] = await db.transaction(async (tx) => {
        // Lock existing default rows to serialize concurrent default switches
        await tx
          .select()
          .from(generationSystemPrompts)
          .where(eq(generationSystemPrompts.isDefault, true))
          .for("update");

        await tx
          .update(generationSystemPrompts)
          .set({ isDefault: false })
          .where(eq(generationSystemPrompts.isDefault, true));

        return tx
          .insert(generationSystemPrompts)
          .values({ name, description, content, isDefault })
          .returning();
      });

      return NextResponse.json(row, { status: 201 });
    } catch (err) {
      // Unique violation or serialization failure → another request won the race
      const code = (err as { code?: string }).code;
      if (code === "23505" || code === "40001") {
        return NextResponse.json(
          { error: "A default prompt already exists. Retry." },
          { status: 409 },
        );
      }
      throw err;
    }
  }

  const [row] = await db
    .insert(generationSystemPrompts)
    .values({ name, description, content, isDefault })
    .returning();

  return NextResponse.json(row, { status: 201 });
}
