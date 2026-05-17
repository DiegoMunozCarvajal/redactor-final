import Link from "next/link";
import { db } from "@/lib/db";
import { bookTemplates } from "@/lib/db/schema";

export default async function AdminBooksPage() {
  const templates = await db.select().from(bookTemplates).orderBy(bookTemplates.createdAt);

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Book Templates</h1>
        <Link href="/admin/books/new" className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm">
          New Template
        </Link>
      </div>

      {templates.length === 0 ? (
        <p className="text-muted-foreground">No templates yet.</p>
      ) : (
        <div className="space-y-2">
          {templates.map((t) => (
            <Link
              key={t.id}
              href={`/admin/books/${t.id}`}
              className="block p-4 border rounded-lg hover:bg-accent transition-colors"
            >
              <h2 className="font-medium">{t.name}</h2>
              {t.description && <p className="text-sm text-muted-foreground mt-1">{t.description}</p>}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
