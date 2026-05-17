import { notFound } from "next/navigation";

import { getProjectByOwner } from "@/lib/db/queries/projects";
import { requireCurrentUserId } from "@/lib/auth/current-user";

export async function requireOwnedProject(projectId: string) {
  const ownerId = await requireCurrentUserId();
  const project = await getProjectByOwner(projectId, ownerId);

  if (!project) {
    notFound();
  }

  return project;
}

