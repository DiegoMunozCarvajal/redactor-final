import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getFullBookTemplate } from "@/lib/db/queries/books";
import { db } from "@/lib/db";
import { chapters, type NewChapter } from "@/lib/db/schema";
import { ChapterEditor } from "@/components/prompts/chapter-editor";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

export default async function AdminBookPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const template = await getFullBookTemplate(id);
  if (!template) notFound();

  const chapterCount = template.chapters.length;

  return (
    <div className="max-w-3xl mx-auto">
      <Breadcrumbs
        items={[
          { label: "Admin", href: "/admin/books" },
          { label: template.name },
        ]}
      />
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold mb-2">{template.name}</h1>
          {template.description && (
            <p className="text-base text-muted-foreground leading-relaxed max-w-prose">
              {template.description}
            </p>
          )}
          <p className="text-sm text-muted-foreground mt-2">
            {chapterCount} {chapterCount === 1 ? "capítulo" : "capítulos"}
          </p>
        </div>
        <form
          action={async () => {
            "use server";
            const maxPos = template.chapters.reduce(
              (max: number, ch) => Math.max(max, ch!.position),
              0,
            );
            await db.insert(chapters).values({
              bookTemplateId: id,
              title: `Capítulo ${maxPos + 1}`,
              position: maxPos + 1,
            } as NewChapter);
            revalidatePath(`/admin/books/${id}`);
          }}
        >
          <Button variant="outline" size="sm">
            <Plus className="h-4 w-4" />
            Add Chapter
          </Button>
        </form>
      </div>

      <div className="space-y-3">
        {template.chapters.map((ch) => (
          <ChapterEditor key={ch!.id} bookId={id} chapter={ch!} />
        ))}
      </div>
    </div>
  );
}
