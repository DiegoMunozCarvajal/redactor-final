export class EditorialBriefIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EditorialBriefIntegrityError";
  }
}

export class EditorialBriefExpectedHashMismatchError extends Error {
  constructor() {
    super("Editorial brief hash mismatch");
    this.name = "EditorialBriefExpectedHashMismatchError";
  }
}

export class EditorialBriefExpectedHashFormatError extends Error {
  constructor() {
    super("expectedHash must be a lowercase SHA-256 hash");
    this.name = "EditorialBriefExpectedHashFormatError";
  }
}

export interface EditorialBriefChapterCoverageErrorInit {
  missingChapterIds: string[];
  extraChapterIds: string[];
  duplicateChapterIds: string[];
}

export class EditorialBriefChapterCoverageError extends Error {
  readonly missingChapterIds: string[];
  readonly extraChapterIds: string[];
  readonly duplicateChapterIds: string[];

  constructor(init: EditorialBriefChapterCoverageErrorInit) {
    const parts: string[] = [];
    if (init.missingChapterIds.length > 0) parts.push(`missing: [${init.missingChapterIds.join(", ")}]`);
    if (init.extraChapterIds.length > 0) parts.push(`extra: [${init.extraChapterIds.join(", ")}]`);
    if (init.duplicateChapterIds.length > 0) parts.push(`duplicate: [${init.duplicateChapterIds.join(", ")}]`);
    super(parts.length > 0 ? parts.join("; ") : "Chapter coverage mismatch");
    this.name = "EditorialBriefChapterCoverageError";
    this.missingChapterIds = init.missingChapterIds;
    this.extraChapterIds = init.extraChapterIds;
    this.duplicateChapterIds = init.duplicateChapterIds;
  }
}
