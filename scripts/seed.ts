import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

async function seed() {
  const sql = postgres(databaseUrl!, { max: 1 });

  const bookId = crypto.randomUUID();

  // Create book template
  await sql`
    INSERT INTO book_templates (id, name, description)
    VALUES (${bookId}, 'Small Book Español', 'Libro pequeño de no-ficción en español. 8 prompts de contenido + ensamblaje por capítulo.')
  `;

  // Create chapters with prompts
  const chapters = [
    { pos: 0, title: "Quién eres cuando te acercas" },
    { pos: 1, title: "Lo que dices y cómo lo dices" },
    { pos: 2, title: "Conectar sin forzar" },
  ];

  const promptTypes = [
    "apertura", "modelo", "contraste", "amplificacion",
    "anecdota", "acumulacion", "proceso", "cierre", "ensamblaje",
  ];

  for (const ch of chapters) {
    const chapterId = crypto.randomUUID();
    await sql`
      INSERT INTO chapters (id, book_template_id, position, title)
      VALUES (${chapterId}, ${bookId}, ${ch.pos}, ${ch.title})
    `;

    for (let i = 0; i < promptTypes.length; i++) {
      await sql`
        INSERT INTO prompts (id, chapter_id, position, type, title, content)
        VALUES (
          ${crypto.randomUUID()},
          ${chapterId},
          ${i},
          ${promptTypes[i]},
          ${`Prompt ${promptTypes[i]}`},
          ${`Escribe sobre [TEMA]. Tipo: ${promptTypes[i]}`}
        )
      `;
    }
  }

  await sql.end();
  console.log("Seed data inserted. Book template ID:", bookId);
  console.log("3 chapters created, each with 9 prompts (8 content + 1 assembly).");
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
