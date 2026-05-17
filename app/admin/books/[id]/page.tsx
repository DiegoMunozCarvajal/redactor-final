import { notFound } from "next/navigation";
import { getFullBookTemplate } from "@/lib/db/queries/books";
import { ChapterEditor } from "@/components/prompts/chapter-editor";

export default async function AdminBookPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const template = await getFullBookTemplate(id);
  if (!template) notFound();

  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold mb-2">{template.name}</h1>
      {template.description && <p className="text-muted-foreground mb-6">{template.description}</p>}

      <div className="space-y-3">
        {template.chapters.map((ch) => (
          <ChapterEditor key={ch!.id} bookId={id} chapter={ch as any} />
        ))}
      </div>
    </div>
  );
}
