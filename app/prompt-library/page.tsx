import { redirect } from "next/navigation";
import { legacyPromptLibraryTarget } from "@/lib/prompts/legacy-redirects";

export default async function LegacyPromptLibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  redirect(legacyPromptLibraryTarget(tab));
}
