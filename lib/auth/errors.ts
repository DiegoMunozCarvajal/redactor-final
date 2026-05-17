export class AuthError extends Error {
  public readonly code: "unauthenticated" | "session_expired" | "service_unavailable";

  constructor(
    message: string,
    code: "unauthenticated" | "session_expired" | "service_unavailable",
  ) {
    super(message);
    this.name = "AuthError";
    this.code = code;
  }
}
