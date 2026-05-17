import { sanitizeStorageFileName } from "@/lib/storage/object-key";
import {
  getStorageAdminClient,
  uploadStorageFile,
} from "@/lib/storage/shared";

const BUCKET = "source-files";

const SAFE_PATH_RE = /^[a-f0-9-]+\/[a-f0-9-]+\/[a-zA-Z0-9_.-]+$/;

function validateStoragePath(storagePath: string): void {
  if (!SAFE_PATH_RE.test(storagePath)) {
    throw new Error(`Invalid storage path: ${storagePath}`);
  }
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

export async function downloadSourceFile(storagePath: string): Promise<Buffer> {
  const supabase = getStorageAdminClient();

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .download(storagePath);

  if (error) throw error;
  const arrayBuffer = await data.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export async function deleteSourceFile(storagePath: string): Promise<void> {
  validateStoragePath(storagePath);
  const supabase = getStorageAdminClient();
  const { error } = await supabase.storage.from(BUCKET).remove([storagePath]);
  if (error) throw error;
}

export async function getSignedDownloadUrl(
  storagePath: string,
  expiresIn: number = 3600
): Promise<string> {
  validateStoragePath(storagePath);
  const supabase = getStorageAdminClient();
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, expiresIn);

  if (error) throw error;
  return data.signedUrl;
}
