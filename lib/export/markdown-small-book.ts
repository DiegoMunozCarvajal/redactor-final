export interface SmallBookUnitForExport {
  sortOrder: number;
  workingTitle: string;
  revisedMarkdown?: string;
  draftMarkdown?: string;
}

const VERIFY_PATTERN = /\[VERIFY:[^\]]*\]|<!-- VERIFY:[^>]*-->/gi;
const NULL_BYTE_PATTERN = /\x00/g;

export function stripNullBytes(text: string): string {
  return text.replace(NULL_BYTE_PATTERN, "");
}

/** Strip null bytes and verification placeholders from AI-generated markdown before DB storage. */
export function sanitizeVerificationPlaceholders(markdown: string): string {
  return stripNullBytes(markdown)
    .replace(VERIFY_PATTERN, "")
    .replace(/\n{3,}/g, "\n\n");
}

export function renderSmallBookMarkdown(args: {
  bookTitle: string;
  units: SmallBookUnitForExport[];
}): string {
  const ordered = [...args.units].sort((a, b) => a.sortOrder - b.sortOrder);

  const chapters = ordered.map((unit) => {
    const body = sanitizeVerificationPlaceholders(
      unit.revisedMarkdown ?? unit.draftMarkdown ?? "",
    );
    return `# Chapter ${unit.sortOrder}: ${unit.workingTitle}\n\n${body.trim()}\n`;
  });

  return [`# ${args.bookTitle}\n`, ...chapters].join("\n");
}
