import { redirect } from "next/navigation";
import { legacyMetaPromptsTarget } from "@/lib/prompts/legacy-redirects";

export default function LegacyMetaPromptsDetailPage() {
  redirect(legacyMetaPromptsTarget());
}
