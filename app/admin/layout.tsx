import Link from "next/link";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="border-b px-6 py-3 flex items-center gap-4">
        <Link href="/admin/books" className="font-semibold">Admin</Link>
        <Link href="/projects" className="text-sm text-muted-foreground">Projects</Link>
      </header>
      <main className="p-6">{children}</main>
    </div>
  );
}
