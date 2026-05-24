import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  projects,
  chapters,
  chapterBriefs,
  projectPrompts,
} from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { eq, and, asc } from "drizzle-orm";
import { generateCompletion, type ReasoningEffort } from "@/lib/ai/completion";
import { csrfCheck } from "@/lib/api/csrf";

const DEFAULT_BRIEF_PROMPT = `Eres un editor senior de no-ficción en español. Tu trabajo es escribir el brief de un capítulo que guiará a otro escritor AI para redactar con precisión.

El brief debe tener exactamente 2 partes, una oración cada una:

1. ALCANCE: qué cubre el capítulo — los conceptos, ideas o habilidades específicas que transmite. Sé concreto: menciona al menos un concepto o ejemplo real que el capítulo desarrollará.

2. RESULTADO: qué podrá hacer el lector al terminar — una acción observable, como "podrá aplicar X en situación Y" o "sabrá distinguir X de Y en contexto Z".

Reglas:
- Entra directo al contenido. Arranca con el concepto o problema central.
- Usa adjetivos que describan cualidades verificables (no "profundo" sino "de tres pasos", no "integral" sino "que cubre desde X hasta Y").
- Cada oración debe aportar información nueva. Sin redundancia.

Ejemplo de buen brief:
"Los seis principios que hacen que una idea sea memorable — simplicidad, concreción, credibilidad, emociones, historias y lo inesperado — explicados con casos como las leyendas urbanas de robos de riñones y la campaña Millones de Subway. Al terminar, el lector podrá auditar cualquier mensaje usando la checklist SUCCESs e identificar exactamente qué principio falta y cómo incorporarlo."

Ejemplo de mal brief:
"Este capítulo examina los factores que influyen en las decisiones alimentarias, ofreciendo una visión integral de cómo el entorno afecta lo que comemos. Al finalizar, el lector tendrá una comprensión más profunda de la psicología de la alimentación."

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

  // Load content prompts (non-assembly) for this chapter
  const promptRows = await db
    .select({ content: projectPrompts.content })
    .from(projectPrompts)
    .where(
      and(
        eq(projectPrompts.chapterId, chapterId),
        eq(projectPrompts.isAssembly, false),
      ),
    )
    .orderBy(asc(projectPrompts.position));

  const systemPrompt = DEFAULT_BRIEF_PROMPT;

  const promptsContext =
    promptRows.length > 0
      ? promptRows
          .map(
            (p, i) =>
              `Prompt ${i + 1}:\n${p.content}`,
          )
          .join("\n\n")
      : "(sin prompts de contenido)";

  const userPrompt = `## Proyecto
${project.title ? `- Título: ${project.title}\n` : ""}- Tema: ${project.topic || "(no definido)"}

## Contenido del capítulo
Los textos entre {llaves} son placeholders que serán sustituidos por definiciones específicas antes de la redacción. Interpreta cada placeholder por su nombre para entender qué tipo de contenido irá en ese lugar.

${promptsContext}

Escribe el brief de este capítulo en 2 oraciones: alcance, resultado.`;

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
