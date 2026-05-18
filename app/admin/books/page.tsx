import Link from "next/link";
import { db } from "@/lib/db";
import { bookTemplates, chapters } from "@/lib/db/schema";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { BookOpen } from "lucide-react";
import { eq, sql, asc } from "drizzle-orm";

export default async function AdminBooksPage() {
  const templates = await db
    .select({
      id: bookTemplates.id,
      name: bookTemplates.name,
      description: bookTemplates.description,
      createdAt: bookTemplates.createdAt,
      chapterCount: sql<number>`cast(count(${chapters.id}) as int)`.as(
        "chapter_count",
      ),
    })
    .from(bookTemplates)
    .leftJoin(chapters, eq(bookTemplates.id, chapters.bookTemplateId))
    .groupBy(bookTemplates.id)
    .orderBy(asc(bookTemplates.createdAt));

  return (
    <div className="max-w-5xl mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Book Templates</h1>
      </div>

      {templates.length === 0 ? (
        <div className="text-center py-16 space-y-4">
          <BookOpen className="h-12 w-12 mx-auto text-muted-foreground" />
          <p className="text-muted-foreground">
            No templates yet. Create your first book template.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {templates.map((t) => (
            <Link key={t.id} href={`/admin/books/${t.id}`}>
              <Card className="h-full hover:bg-accent transition-colors">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">{t.name}</CardTitle>
                </CardHeader>
                <CardContent>
                  {t.description ? (
                    <CardDescription className="line-clamp-3">
                      {t.description}
                    </CardDescription>
                  ) : (
                    <CardDescription className="italic">
                      No description
                    </CardDescription>
                  )}
                  <p className="text-xs text-muted-foreground mt-2">
                    {t.chapterCount}{" "}
                    {t.chapterCount === 1 ? "capítulo" : "capítulos"}
                  </p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
