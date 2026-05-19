export default async function BookLayout({
  children,
}: {
  children: React.ReactNode
  params: Promise<{ id: string }>
}) {
  return <>{children}</>
}
