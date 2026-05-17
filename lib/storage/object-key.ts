function stripDiacritics(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
}

export function sanitizeStorageFileName(
  fileName: string,
  fallbackBase: string = "file"
) {
  const trimmed = fileName.trim();
  const lastDot = trimmed.lastIndexOf(".");
  const rawBase = lastDot > 0 ? trimmed.slice(0, lastDot) : trimmed;
  const rawExtension = lastDot > 0 ? trimmed.slice(lastDot + 1) : "";

  const safeBase = stripDiacritics(rawBase)
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 120);

  const safeExtension = stripDiacritics(rawExtension)
    .replace(/[^A-Za-z0-9]+/g, "")
    .toLowerCase()
    .slice(0, 10);

  const base = safeBase || fallbackBase;
  return safeExtension ? `${base}.${safeExtension}` : base;
}
