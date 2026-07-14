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
