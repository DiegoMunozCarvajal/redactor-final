// ---------------------------------------------------------------------------
// Placeholder and text transformation utilities
// ---------------------------------------------------------------------------
// Extracted from lib/generate.ts to break the circular dependency between
// generate.ts (which wraps executeChapterPrompt) and chapter-executor.ts
// (which needs placeholder replacement).  These are pure functions with no
// module-level dependencies.

/** Shared control-character stripper — single source of truth for
 *  sanitizeValue and serializePromptText. */
const CONTROL_CHARACTERS_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

export function stripControlCharacters(value: string): string {
  return value.replace(CONTROL_CHARACTERS_RE, '');
}

/** Escape plain untrusted text for safe XML-like prompt insertion.
 *  Strips control characters, then escapes &, <, >.
 *  Does NOT escape << / >> — those are placeholder-wrapper syntax,
 *  not used in review/title/template marker composition. */
export function serializePromptText(value: string): string {
  return escapeXmlText(stripControlCharacters(value));
}

export function sanitizeValue(value: string): string {
  return stripControlCharacters(value).replace(/<</g, "‹‹").replace(/>>/g, "››").trim();
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Escape user-generated text for safe insertion inside XML-like prompt tags.
 *  Prevents fragment content containing `</seccion>` or `</content>` from
 *  breaking prompt framing or injecting instructions into downstream LLM calls. */
export function escapeXmlText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Escape text for use in XML attribute values (double-quoted). */
export function escapeXmlAttr(text: string): string {
  return escapeXmlText(text).replace(/"/g, "&quot;");
}

export function applyPlaceholders(
  content: string,
  placeholders: Record<string, string>,
  projectTopic?: string | null,
): string {
  // Sort longest-first to prevent {foo} matching inside {foo_bar}
  const entries = Object.entries(placeholders).sort(
    ([a], [b]) => b.length - a.length,
  );
  for (const [name, value] of entries) {
    const sanitized = sanitizeValue(value);
    // Case-insensitive regex: {tema} matches {TEMA}, {Tema}, etc.
    const regex = new RegExp(`\\{${escapeRegex(name)}\\}`, "gi");
    // Escape $ to prevent special pattern interpretation in replace ($&, $1, etc.)
    content = content.replace(
      regex,
      `<<${name.toUpperCase()}>>${sanitized.replace(/\$/g, "$$$$")}<</${name.toUpperCase()}>>`,
    );
  }
  // Fallback: if {tema} wasn't in the placeholder map but project has a topic, use it
  if (projectTopic && !placeholders["tema"]) {
    const sanitized = sanitizeValue(projectTopic);
    content = content.replace(
      /\{tema\}/gi,
      `<<TEMA>>${sanitized.replace(/\$/g, "$$$$")}<</TEMA>>`,
    );
  }
  return content;
}

/** Strip <<NAME>>...<</NAME>> wrappers that applyPlaceholders inserts.
 *  LLMs sometimes reproduce these verbatim. Remove them from generated output. */
export function stripPlaceholderWrappers(text: string): string {
  return text.replace(/<<([A-Z_]+)>>([\s\S]*?)<<\/\1>>/g, "$2");
}
