import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { eq } from "drizzle-orm";
import { csrfCheck } from "@/lib/api/csrf";
import { generateCompletion, type ReasoningEffort } from "@/lib/ai/completion";

const DESCRIPTION_SYSTEM = `Eres un editor senior especializado en libros de no-ficción en español. Tu trabajo es escribir descripciones de libros que capturan la atención del lector correcto.

Reglas estructurales:
- 2-4 oraciones. No más de 80 palabras en total.
- Primera oración: el problema que resuelve o la pregunta que responde el libro
- Segunda oración: el enfoque único, metodología o ángulo del libro
- Tercera oración: el lector ideal y el resultado que obtiene
- Cuarta oración (opcional): diferenciador frente a otros enfoques del mismo tema

Reglas de estilo:
- Prohibido: adjetivos vacíos ("revolucionario", "innovador", "imprescindible", "fascinante")
- Prohibido: empezar con "Este libro..." o "En este libro..."
- Prohibido: clichés ("en la era digital", "en un mundo cada vez más...")
- Obligatorio: incluir al menos un concepto concreto del tema (no generalidades)

Ejemplo de buena descripción:
"¿Por qué algunas ideas sobreviven y otras mueren? Made to Stick analiza seis principios que hacen que una idea sea memorable — desde la simplicidad hasta la emoción — usando casos reales como las leyendas urbanas de robos de riñones y la campaña de Subway. Para comunicadores, marketers y cualquiera que necesite que su mensaje se grabe en la mente de su audiencia."

Ejemplo de mala descripción (NO hagas esto):
"Este libro revolucionario explora el fascinante mundo de la comunicación efectiva, ofreciendo herramientas innovadoras para transmitir ideas de manera impactante en un mundo cada vez más conectado."

Responde ÚNICAMENTE con la descripción. Sin comillas, sin etiquetas, sin JSON, sin introducción.`;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const csrfError = csrfCheck(req);
  if (csrfError) return csrfError;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;

  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, id))
    .limit(1);
  if (!project || project.userId !== user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const model = (body.model as string) || undefined;
  const effort = body.effort as ReasoningEffort | undefined;
  const temperatureRaw = body.temperature;
  if (temperatureRaw !== undefined && (typeof temperatureRaw !== "number" || temperatureRaw < 0 || temperatureRaw > 1)) {
    return NextResponse.json({ error: "temperature must be a number between 0 and 1" }, { status: 400 });
  }
  const temperature = temperatureRaw as number | undefined;

  if (!project.name) {
    return NextResponse.json({ error: "project has no name" }, { status: 400 });
  }

  const bookName = project.title ?? project.name;

  const userPrompt = `Escribe la descripción para este libro:

## Datos del libro
- Nombre: ${bookName}
- Tema: ${project.topic || "(no definido)"}

Escribe una descripción de 2-4 oraciones en español.`;

  try {
    const result = await generateCompletion({
      model: model || "deepseek-v4-flash",
      systemPrompt: DESCRIPTION_SYSTEM,
      userPrompt,
      ...(effort ? { effort } : {}),
      ...(temperature !== undefined ? { temperature } : {}),
    });

    const description = (result.data as string).trim();

    await db
      .update(projects)
      .set({ description })
      .where(eq(projects.id, id));

    return NextResponse.json({ description });
  } catch (err) {
    console.error("[description/generate] Failed:", err);
    return NextResponse.json(
      { error: "Generation failed" },
      { status: 502 },
    );
  }
}
