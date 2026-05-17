import { createClient } from "@supabase/supabase-js";

function getStorageEnvOrThrow() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL environment variable is required");
  }

  if (!serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY environment variable is required");
  }

  return { supabaseUrl, serviceRoleKey };
}

export function getStorageAdminClient() {
  const { supabaseUrl, serviceRoleKey } = getStorageEnvOrThrow();
  return createClient(supabaseUrl, serviceRoleKey);
}

function isBucketNotFoundError(error: { message?: string } | null) {
  return Boolean(error?.message?.toLowerCase().includes("bucket not found"));
}

function isBucketAlreadyExistsError(error: { message?: string } | null) {
  return Boolean(
    error?.message?.toLowerCase().includes("already exists") ||
      error?.message?.toLowerCase().includes("duplicate")
  );
}

async function ensureBucketExists(bucket: string) {
  const supabase = getStorageAdminClient();
  const { error } = await supabase.storage.createBucket(bucket, {
    public: false,
  });

  if (error && !isBucketAlreadyExistsError(error)) {
    throw error;
  }
}

export async function uploadStorageFile(params: {
  bucket: string;
  path: string;
  file: Buffer;
  contentType?: string;
}) {
  const { bucket, path, file, contentType } = params;
  const supabase = getStorageAdminClient();
  const uploadOptions = {
    upsert: true,
    ...(contentType ? { contentType } : {}),
  };

  let { error } = await supabase.storage.from(bucket).upload(path, file, uploadOptions);

  if (isBucketNotFoundError(error)) {
    await ensureBucketExists(bucket);
    ({ error } = await supabase.storage.from(bucket).upload(path, file, uploadOptions));
  }

  if (error) {
    throw error;
  }
}
