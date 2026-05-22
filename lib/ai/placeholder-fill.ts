import { generateCompletion } from "./completion";
import { DEFAULT_GENERATION_MODEL } from "./providers";
import { webSearchBatch, type SearchResult } from "./web-search";

// Re-export SearchResult for convenience
export type { SearchResult };

export interface PlaceholderFillEvent {
  type: "placeholder" | "done" | "error";
  name?: string;
  definition?: string;
  sources?: SearchResult[];
  error?: string;
}

// Fast model for research decisions — same as DEFAULT_GENERATION_MODEL for now;
// swap to a cheaper provider when one becomes available.
const RESEARCH_MODEL = "deepseek-v4-flash";

// Default model for generation if none specified
const DEFAULT_MODEL = DEFAULT_GENERATION_MODEL;

function extractJson(text: string): any {
  try {
    return JSON.parse(text);
  } catch {}
  const match = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (match) {
    try {
      return JSON.parse(match[1]);
    } catch {}
  }
  const objMatch = text.match(/\{[\s\S]*\}/);
  if (objMatch) {
    try {
      return JSON.parse(objMatch[0]);
    } catch {}
  }
  throw new Error("Could not parse JSON from response");
}

const RESEARCH_DECISION_PROMPT = `You are a research planner. Given:
1. A project description
2. A chapter brief
3. A list of placeholder names

For each placeholder, decide whether it needs web research to fill accurately.
Return a JSON array of placeholder names that need research. Only include ones where factual accuracy matters (e.g., sources, papers, studies, historical facts, data points). Skip ones that are purely stylistic (e.g., tone, audience description, voice).

Example:
Placeholders: ["TEMA_DEL_LIBRO", "TONO_DEL_LIBRO", "FUENTE_O_PAPER_BASE", "LECTOR_OBJETIVO"]
Return: ["TEMA_DEL_LIBRO", "FUENTE_O_PAPER_BASE"]`;

const FILL_SYSTEM_PROMPT = `You are an expert book researcher and ghostwriter. Your task is to define placeholder values for a book chapter.

## Input
- Project description: what the book is about
- Chapter brief: what this specific chapter covers
- Placeholder names: the {placeholders} that need definitions
- Research results: web search findings for factual placeholders (if any)

## Instructions
1. Define each placeholder with a concise, research-backed value
2. Use the research results when available for factual placeholders
3. Each definition should be 1-3 sentences, specific and actionable
4. Align with the chapter brief and project description
5. Output ONLY valid JSON: {"placeholders": {"NAME": "definition", ...}}

## Example
Input placeholders: ["TEMA_DEL_LIBRO", "TONO_DEL_LIBRO"]
Output: {"placeholders": {"TEMA_DEL_LIBRO": "Atomic habits and behavior change through systems thinking", "TONO_DEL_LIBRO": "Practical, authoritative but warm, backed by research"}}`;

export async function researchPlaceholders(
  placeholderNames: string[],
  chapterBrief: string,
  projectDescription: string,
): Promise<Record<string, SearchResult[]>> {
  if (placeholderNames.length === 0) return {};

  // Phase 1a: Decide which placeholders need research
  const decisionPrompt = `${RESEARCH_DECISION_PROMPT}\n\nProject: ${projectDescription || "(none)"}\nChapter brief: ${chapterBrief || "(none)"}\nPlaceholders: ${JSON.stringify(placeholderNames)}`;

  let needsResearch: string[] = [];
  try {
    const decision = await generateCompletion({
      model: RESEARCH_MODEL,
      systemPrompt: "",
      userPrompt: decisionPrompt,
    });
    const parsed = extractJson(decision.data as string);
    needsResearch = Array.isArray(parsed)
      ? parsed
      : (parsed.needsResearch ?? []);
  } catch {
    // If provider fails or parsing fails, research all
    needsResearch = placeholderNames;
  }

  // Phase 1b: Execute searches
  if (needsResearch.length === 0) return {};

  // Build query → placeholder name map so we can key results by name
  const queryToName = new Map<string, string>();
  const searchQueries = needsResearch.map((name) => {
    const readable = name.replace(/_/g, " ").toLowerCase();
    const query = `${readable} ${projectDescription || ""} ${chapterBrief || ""}`.trim();
    queryToName.set(query, name);
    return query;
  });

  const batchResults = await webSearchBatch(searchQueries);

  // Transform from Record<query, SearchResult[]> to Record<placeholderName, SearchResult[]>
  const results: Record<string, SearchResult[]> = {};
  for (const [query, hits] of Object.entries(batchResults)) {
    const name = queryToName.get(query);
    if (name) {
      results[name] = hits;
    }
  }
  return results;
}

export async function* fillPlaceholders(
  placeholderNames: string[],
  chapterBrief: string,
  projectDescription: string,
  promptContents: string[],
  searchResults: Record<string, SearchResult[]>,
  model: string = DEFAULT_MODEL,
  customSystemPrompt?: string,
): AsyncGenerator<PlaceholderFillEvent> {
  const systemPrompt = customSystemPrompt || FILL_SYSTEM_PROMPT;

  // Build the research context
  let researchContext = "";
  if (Object.keys(searchResults).length > 0) {
    researchContext = "\n\n## Research Results\n";
    for (const [name, results] of Object.entries(searchResults)) {
      if (results.length === 0) continue;
      researchContext += `\n### ${name.replace(/_/g, " ")}\n`;
      for (const r of results) {
        researchContext += `- ${r.title}\n  ${r.snippet}\n  URL: ${r.url}\n`;
      }
    }
  }

  const userPrompt = `## Project Description\n${projectDescription || "(none)"}

## Chapter Brief
${chapterBrief || "(none)"}

## Content Prompts (for context)
${promptContents
    .map(
      (c, i) =>
        `Prompt ${i + 1}: ${c.slice(0, 200)}${c.length > 200 ? "..." : ""}`,
    )
    .join("\n\n")}

${researchContext}

## Placeholders to Define
${JSON.stringify(placeholderNames)}

Define each placeholder. Return JSON: {"placeholders": {"NAME": "definition", ...}}`;

  let result;
  try {
    result = await generateCompletion({
      model,
      systemPrompt,
      userPrompt,
      effort: "max",
    });
  } catch (err) {
    yield {
      type: "error",
      error: `Provider failure: ${(err as Error).message}`,
    };
    return;
  }

  try {
    const parsed = extractJson(result.data as string);
    const definitions: Record<string, string> = parsed.placeholders ?? parsed;

    for (const name of placeholderNames) {
      const definition = definitions[name];
      if (definition) {
        // Look up sources directly by placeholder name
        const placeholderSources = searchResults[name] ?? [];

        yield {
          type: "placeholder",
          name,
          definition,
          sources: placeholderSources.slice(0, 5),
        };
      } else {
        yield { type: "error", name, error: `No definition generated for {${name}}` };
      }
    }
  } catch (err) {
    yield {
      type: "error",
      error: `Failed to parse response: ${(err as Error).message}`,
    };
    return;
  }

  yield { type: "done" };
}

export async function fillSinglePlaceholder(
  name: string,
  chapterBrief: string,
  projectDescription: string,
  promptContents: string[],
  existingDefinitions: Record<string, string>,
  model: string = DEFAULT_MODEL,
  customSystemPrompt?: string,
): Promise<{ definition: string; sources: SearchResult[] }> {
  // Research this specific placeholder
  const query = `${name.replace(/_/g, " ")} ${projectDescription || ""}`.trim();
  const searchResults = await webSearchBatch([query]);
  const sources = searchResults[query] ?? [];

  let researchContext = "";
  if (sources.length > 0) {
    researchContext = "\n\n## Research Results\n";
    for (const r of sources) {
      researchContext += `- ${r.title}\n  ${r.snippet}\n  URL: ${r.url}\n`;
    }
  }

  const systemPrompt =
    customSystemPrompt ||
    `You are an expert book researcher. Define this single placeholder with a concise, research-backed value that fits the chapter. Output ONLY: {"definition": "..."}`;

  const userPrompt = `## Project Description\n${projectDescription || "(none)"}

## Chapter Brief
${chapterBrief || "(none)"}

## Existing Placeholder Definitions (for context)
${Object.entries(existingDefinitions)
  .map(([k, v]) => `- {${k}}: ${v}`)
  .join("\n")}

${researchContext}

## Placeholder to Define
{${name}}

Return JSON: {"definition": "your concise definition"}`;

  const result = await generateCompletion({
    model,
    systemPrompt,
    userPrompt,
    effort: "max",
  });

  try {
    const parsed = extractJson(result.data as string);
    return { definition: parsed.definition ?? "", sources };
  } catch {
    return { definition: (result.data as string).trim(), sources };
  }
}
