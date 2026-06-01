"""DSPy Signatures for the redactor-v4 generation pipeline.

Each signature mirrors what the TypeScript pipeline does:
- GenerateChapterFragment → generatePromptContent()
- AssembleChapter → generateChapterAssembly()
"""

from __future__ import annotations

import dspy


# ── Content generation ───────────────────────────────────────────


class GenerateChapterFragment(dspy.Signature):
    """Genera una sección de capítulo de no-ficción en español.

    Eres un escritor senior de no-ficción en español. Escribes con:
    - Español claro y preciso. Oraciones cortas (15-25 palabras) con ritmo variado.
    - Un párrafo = una idea. Máximo 5 oraciones por párrafo.
    - Voz activa. Pasiva solo cuando el sujeto no importa.
    - Cada afirmación no obvia la respaldas con un ejemplo, dato o fuente concreta.
    - Conceptos abstractos los aterrizas de inmediato con una ilustración.
    - Citas a estudios incluyen autor o institución.
    - Transiciones explícitas entre párrafos.
    - Atributos verificables: no "un estudio importante" sino "un estudio de 2023 con 12,000 participantes".

    Evitas:
    - Adjetivos que no informan: "integral", "profundo", "innovador".
    - Relleno: "realmente", "verdaderamente", "básicamente", "simplemente".
    - Aperturas que anuncian en vez de enganchar: "En este capítulo...".

    Respondes ÚNICAMENTE con el contenido de la sección. Sin títulos, sin etiquetas."""

    topic: str = dspy.InputField(
        desc="Tema del proyecto/libro (ej: 'Gestión del tiempo para profesionales')"
    )
    chapter_brief: str = dspy.InputField(
        desc="Brief del capítulo: alcance, lector objetivo, resultado esperado"
    )
    instruction: str = dspy.InputField(
        desc="Instrucción específica del prompt con placeholders ya resueltos"
    )
    style_rules: str = dspy.InputField(
        desc="Reglas de estilo adicionales a seguir (opcional)"
    )

    generated_text: str = dspy.OutputField(
        desc="Sección del capítulo en español, sin títulos ni etiquetas"
    )


# ── Assembly ─────────────────────────────────────────────────────


class AssembleChapter(dspy.Signature):
    """Ensambla fragmentos en un capítulo unificado de no-ficción en español.

    Eres un editor senior que ensambla capítulos de libros. Recibes fragmentos
    escritos por distintos redactores y tu trabajo es fusionarlos en un capítulo
    unificado, cohesivo y con voz consistente.

    Cómo trabajas:
    - Eliminas redundancias. Fragmentos que dicen lo mismo se consolidan en uno solo.
    - Tejes transiciones explícitas entre fragmentos.
    - Si hay contradicción, resuelves a favor del más preciso o matizas la diferencia.
    - Organizas el contenido de lo general a lo específico.

    Voz y estilo:
    - Unificas el tono hacia lo que pide el brief del capítulo.
    - Consistencia terminológica: mismo término para el mismo concepto.
    - Sin adjetivos vacíos, sin clichés, sin muletillas, voz activa.

    Formato:
    - ## para el título del capítulo, ### para secciones internas.
    - Sin marcas de fragmentos, sin referencias al proceso de ensamblaje.

    Respondes ÚNICAMENTE con el capítulo ensamblado."""

    topic: str = dspy.InputField(desc="Tema del proyecto/libro")
    chapter_brief: str = dspy.InputField(
        desc="Brief del capítulo que define estructura, alcance y audiencia"
    )
    fragments: str = dspy.InputField(desc="Fragmentos a ensamblar, separados por ---")
    style_rules: str = dspy.InputField(
        desc="Reglas de estilo para unificar la voz (opcional)"
    )

    assembled_chapter: str = dspy.OutputField(
        desc="Capítulo ensamblado en markdown español, con ## título y ### secciones"
    )


# ── Pipeline (compuesto) ────────────────────────────────────────


class ChapterGenerationPipeline(dspy.Module):
    """Pipeline completo: genera fragmentos → ensambla capítulo.

    This is the composite module that MIPROv2 can optimize end-to-end.
    Each content prompt becomes a Predict call; the assembly is the final step.

    Usage:
        pipeline = ChapterGenerationPipeline(content_instructions=["prompt1", "prompt2"])
        result = pipeline(topic="...", chapter_brief="...", style_rules="...")
    """

    def __init__(self, content_instructions: list[str] | None = None):
        super().__init__()
        self.content_instructions = content_instructions or []
        self.content_generators = [
            dspy.Predict(GenerateChapterFragment) for _ in self.content_instructions
        ]
        self.assembly = dspy.Predict(AssembleChapter)

    def forward(
        self,
        topic: str,
        chapter_brief: str,
        style_rules: str = "",
    ) -> dspy.Prediction:
        fragments: list[str] = []

        for i, (generator, instruction) in enumerate(
            zip(self.content_generators, self.content_instructions)
        ):
            result = generator(
                topic=topic,
                chapter_brief=chapter_brief,
                instruction=instruction,
                style_rules=style_rules,
            )
            fragments.append(f"### Fragment {i + 1}\n\n{result.generated_text}")

        fragments_text = "\n\n---\n\n".join(fragments)

        assembled = self.assembly(
            topic=topic,
            chapter_brief=chapter_brief,
            fragments=fragments_text,
            style_rules=style_rules,
        )

        return dspy.Prediction(
            fragments=[f.generated_text for f in fragments],  # type: ignore[attr-defined]
            assembled_chapter=assembled.assembled_chapter,
        )
