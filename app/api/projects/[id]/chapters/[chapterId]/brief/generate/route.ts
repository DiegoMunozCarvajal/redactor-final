import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  projects,
  chapters,
  chapterBriefs,
  chapterConfigPrompts,
} from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { eq, and } from "drizzle-orm";
import { generateCompletion, type ReasoningEffort } from "@/lib/ai/completion";
import { csrfCheck } from "@/lib/api/csrf";

const DEFAULT_BRIEF_PROMPT = `Eres un editor senior de no-ficción en español. Tu trabajo es escribir el brief de un capítulo que guiará a otro escritor AI para redactar con precisión.

El brief debe tener exactamente 3 partes, una oración cada una:

1. ALCANCE: qué cubre el capítulo — conceptos, ideas o habilidades específicas que debe transmitir. Nada genérico. Menciona al menos un concepto concreto del capítulo.

2. LECTOR: para quién se escribe — qué sabe ya, qué necesita saber, qué nivel de familiaridad tiene con el tema.

3. RESULTADO: qué debe saber/hacer/pensar el lector al terminar — el takeaway concreto, no "entenderá X" vago sino "podrá aplicar X en situación Y".

Reglas de estilo:
- Prohibido: adjetivos vacíos ("integral", "profundo", "completo")
- Prohibido: "Este capítulo explora/examina/presenta..." (muletilla)
- Prohibido: mencionar prompts, fragmentos o aspectos técnicos de la generación (el lector del brief es otro sistema, no el usuario final)
- Cada oración debe aportar información distinta. Sin redundancia.
- Usar lenguaje concreto, no abstracto.

Ejemplo de buen brief:
"Este capítulo desglosa los seis principios de sticky ideas — simplicidad, concreción, credibilidad, emociones, historias y lo inesperado — con ejemplos del mundo publicitario y el periodismo. Está escrito para profesionales de comunicación que ya dominan conceptos básicos de marketing pero buscan un marco sistemático para evaluar y mejorar sus mensajes. Al terminar, el lector podrá auditar cualquier pieza de comunicación usando la checklist SUCCESs e identificar exactamente qué principio falta y cómo incorporarlo."

Ejemplo de mal brief (NO hagas esto):
"Este capítulo explora los principios fundamentales de la comunicación efectiva, ofreciendo una visión integral de las estrategias más importantes para transmitir ideas. Está diseñado para un público amplio interesado en mejorar sus habilidades comunicativas. Al finalizar, el lector tendrá una comprensión más profunda de cómo comunicar mejor."

Responde ÚNICAMENTE con el brief. Sin etiquetas, sin JSON, sin comillas.`;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; chapterId: string }> },
) {
  const csrfError = csrfCheck(req);
  if (csrfError) return csrfError;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id, chapterId } = await params;

  // Verify project ownership
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, id))
    .limit(1);
  if (!project || project.userId !== user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // Verify chapter belongs to project
  const [chapter] = await db
    .select()
    .from(chapters)
    .where(and(eq(chapters.id, chapterId), eq(chapters.projectId, id)))
    .limit(1);
  if (!chapter)
    return NextResponse.json({ error: "chapter not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const model = (body.model as string) || undefined;
  const effort = body.effort as ReasoningEffort | undefined;
  const temperatureRaw = body.temperature;
  if (temperatureRaw !== undefined && (typeof temperatureRaw !== "number" || temperatureRaw < 0 || temperatureRaw > 1)) {
    return NextResponse.json({ error: "temperature must be a number between 0 and 1" }, { status: 400 });
  }
  const temperature = temperatureRaw as number | undefined;

  // Load custom system prompt if exists
  const [config] = await db
    .select()
    .from(chapterConfigPrompts)
    .where(
      and(
        eq(chapterConfigPrompts.chapterId, chapterId),
        eq(chapterConfigPrompts.type, "generate_brief"),
      ),
    );

  const systemPrompt = config?.content || DEFAULT_BRIEF_PROMPT;

  const userPrompt = `## Proyecto
- Nombre: ${(project.title ?? project.name) || "(unnamed)"}
- Tema: ${project.topic || "(no definido)"}
- Descripción: ${project.description || "(no definida)"}

## Capítulo
- Título: ${chapter.title}

Escribe el brief de este capítulo en 3 oraciones: alcance, lector, resultado.`;

  let briefContent: string;
  try {
    const result = await generateCompletion({
      model: model || "deepseek-v4-flash",
      systemPrompt,
      userPrompt,
      ...(effort ? { effort } : {}),
      ...(temperature !== undefined ? { temperature } : {}),
    });
    briefContent = (result.data as string).trim();
  } catch (err) {
    console.error("[brief/generate] AI call failed:", err);
    return NextResponse.json({ error: "Generation failed" }, { status: 502 });
  }

  const [brief] = await db
    .insert(chapterBriefs)
    .values({ chapterId, content: briefContent })
    .onConflictDoUpdate({
      target: chapterBriefs.chapterId,
      set: { content: briefContent, updatedAt: new Date() },
    })
    .returning();

  return NextResponse.json(brief);
}
