import { AdminSidebar } from "@/components/patterns/admin-sidebar"
import { db } from "@/lib/db/drizzle"
import { chapters } from "@/lib/db/schema"
import { eq, isNull, and } from "drizzle-orm"

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
    .where(
      and(
        eq(chapters.bookTemplateId, id),
        isNull(chapters.projectId),
      ),
    )
    .orderBy(chapters.position)

  return (
    <div className="flex min-h-[calc(100vh-3.5rem)]">
      <AdminSidebar chapters={bookChapters} bookId={id} />
      <div className="flex-1 min-w-0">
        <div className="px-6 pb-12">
          {children}
        </div>
      </div>
    </div>
  )
}
