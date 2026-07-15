import { redirect } from "next/navigation";
import { legacyPromptDetailTarget } from "@/lib/prompts/legacy-redirects";

export default function LegacyPromptLibraryDetailPage() {
  redirect(legacyPromptDetailTarget());
}
