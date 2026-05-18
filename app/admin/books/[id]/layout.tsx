import { AdminSidebar } from "@/components/patterns/admin-sidebar"
import { db } from "@/lib/db/drizzle"
import { chapters } from "@/lib/db/schema"
import { eq } from "drizzle-orm"

export default async function BookLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const bookChapters = await db
    .select({
      id: chapters.id,
      title: chapters.title,
      position: chapters.position,
    })
    .from(chapters)
    .where(eq(chapters.bookTemplateId, id))
    .orderBy(chapters.position)

  return (
    <div className="flex min-h-[calc(100vh-3.5rem)]">
      <AdminSidebar chapters={bookChapters} bookId={id} />
      <div className="flex-1 min-w-0">
        <main className="px-6 pb-12">
          {children}
        </main>
      </div>
    </div>
  )
}
