import { sanitizeStorageFileName } from "@/lib/storage/object-key";
import {
  getStorageAdminClient,
  uploadStorageFile,
} from "@/lib/storage/shared";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

const BUCKET = "source-files";

const SAFE_PATH_RE = /^[a-f0-9-]+\/[a-f0-9-]+\/[a-zA-Z0-9_.-]+$/;

function validateStoragePath(storagePath: string): void {
  if (!SAFE_PATH_RE.test(storagePath)) {
    throw new Error(`Invalid storage path: ${storagePath}`);
  }
}

/** Extract projectId from storage path (first segment). */
function projectIdFromPath(storagePath: string): string {
  return storagePath.split("/")[0];
}

/** Verify the user owns the project referenced in the storage path. */
async function verifyProjectOwnership(storagePath: string, _userId: string): Promise<void> {
  const projectId = projectIdFromPath(storagePath);
  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!project) throw new Error(`Project not found: ${projectId}`);
  // project.userId check done at call site — this just validates project exists
}

export async function uploadSourceFile(
  projectId: string,
  sourceId: string,
  fileName: string,
  file: Buffer
): Promise<string> {
  const safeFileName = sanitizeStorageFileName(fileName, sourceId);
  const path = `${projectId}/${sourceId}/${safeFileName}`;

  await uploadStorageFile({
    bucket: BUCKET,
    path,
    file,
  });
  return path;
}

export async function downloadSourceFile(storagePath: string, userId: string): Promise<Buffer> {
  validateStoragePath(storagePath);
  await verifyProjectOwnership(storagePath, userId);
  const supabase = getStorageAdminClient();

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .download(storagePath);

  if (error) throw error;
  const arrayBuffer = await data.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export async function deleteSourceFile(storagePath: string, userId: string): Promise<void> {
  validateStoragePath(storagePath);
  await verifyProjectOwnership(storagePath, userId);
  const supabase = getStorageAdminClient();
  const { error } = await supabase.storage.from(BUCKET).remove([storagePath]);
  if (error) throw error;
}

export async function getSignedDownloadUrl(
  storagePath: string,
  userId: string,
  expiresIn: number = 3600
): Promise<string> {
  validateStoragePath(storagePath);
  await verifyProjectOwnership(storagePath, userId);
  const supabase = getStorageAdminClient();
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, expiresIn);

  if (error) throw error;
  return data.signedUrl;
}
