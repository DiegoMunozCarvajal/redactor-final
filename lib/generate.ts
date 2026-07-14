import type { ReasoningEffort } from "@/lib/ai/completion";
import { generateCompletion } from "@/lib/ai/completion";
import {
  DEFAULT_GENERATION_MODEL,
  getModelDefinition,
  getProviderForModel,
} from "@/lib/ai/providers";
import { STYLE_RULES } from "@/lib/ai/system-prompts";
import { assertOriginalEnough } from "@/lib/ai/originality-check";
import { executeChapterPrompt } from "@/lib/prompts/chapter-executor";
import {
  sanitizeValue,
  applyPlaceholders,
  stripPlaceholderWrappers,
  escapeXmlText,
  escapeXmlAttr,
} from "@/lib/prompts/placeholder-transform";
import type { ZodType } from "zod";

// Re-export placeholder utilities for backward compatibility
export { sanitizeValue, applyPlaceholders, stripPlaceholderWrappers, escapeXmlText, escapeXmlAttr };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PromptLike {
  content: string;
  userPrompt?: string | null;
}

export interface GeneratePromptParams {
  prompt: PromptLike;
  placeholders: Record<string, string>;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  effort?: ReasoningEffort;
  /** Project topic. Used as fallback when {tema} placeholder has no definition. */
  projectTopic?: string | null;
  /** Project ID. Used to resolve project-level system prompt override and to pass to chapter executor. */
  projectId?: string;
  /** Editorial brief context rendered as XML. Injected into system prompt with Anthropic cache split. */
  editorialContext?: string | null;
  /** Zod schema for structured output. When set, the LLM returns parsed JSON. */
  schema?: ZodType;
  /** Per-call abort signal. Set below Trigger task maxDuration so errors are caught before hard kill. */
  signal?: AbortSignal;
  /** Chapter ID — required for the chapter executor. */
  chapterId?: string;
  /** Chapter generation ID — required for the chapter executor. */
  chapterGenerationId?: string;
  /** The currentRevisionId from the prompt row — identifies the immutable version to use. */
  chapterPromptRevisionId?: string;
}

/** Assembly output scales with fragment count. Each fragment contributes ~2048 tokens.
 *  Base floor accounts for thinking overhead when effort is active. */
function assemblyMaxTokens(fragmentCount: number, model?: string): number {
  const computed = Math.max(32768, fragmentCount * 2048);
  if (model) {
    const def = getModelDefinition(model);
    if (def?.maxOutputTokens) return Math.min(computed, def.maxOutputTokens);
  }
  return computed;
}

export interface GenerateResult {
  text: string;
  model: string;
  provider: string;
  durationMs?: number;
  usage: {
    inputTokens: number;
    outputTokens: number;
    costUsd?: number;
    cacheCreationTokens?: number;
    cacheReadTokens?: number;
  };
  /** Execution ID linking to the llm_prompt_executions row. Present when
   *  the call went through executeChapterPrompt (fragment generation). */
  executionId?: string;
}

// ---------------------------------------------------------------------------
// Fragment content generation
// ---------------------------------------------------------------------------

export async function generatePromptContent(
  params: GeneratePromptParams,
): Promise<GenerateResult> {
  const {
    prompt,
    placeholders,
    model = DEFAULT_GENERATION_MODEL,
    projectTopic,
    projectId,
    editorialContext,
    signal,
    chapterId,
    chapterGenerationId,
    chapterPromptRevisionId,
    effort,
  } = params;

  // Route through the prompt registry executor when we have a revision ID.
  // This is the new path — every call site that provides currentRevisionId
  // gets versioned execution with full lineage tracking.
  if (chapterPromptRevisionId && chapterId && chapterGenerationId && projectId) {
    const result = await executeChapterPrompt({
      projectId,
      chapterId,
      chapterGenerationId,
      chapterPromptRevisionId,
      editorialContext: editorialContext ?? null,
      placeholders,
      projectTopic: projectTopic ?? null,
      model,
      ...(effort !== undefined ? { effort } : {}),
      ...(signal !== undefined ? { signal } : {}),
    });

    return {
      text: result.text,
      model,
      provider: getProviderForModel(model),
      durationMs: result.durationMs,
      usage: {
        inputTokens: result.usage.promptTokens,
        outputTokens: result.usage.completionTokens,
        costUsd: result.usage.costUsd,
        cacheCreationTokens: result.usage.cacheCreationTokens,
        cacheReadTokens: result.usage.cacheReadTokens,
      },
      executionId: result.executionId,
    };
  }

  // Legacy path — fallback for callers that haven't been updated to provide
  // the new required fields. Uses direct generateCompletion as before.
  // When userPrompt is set: content = system, userPrompt = user message (metaprompt pattern)
  const effectiveSystemPrompt = prompt.userPrompt ? prompt.content : "";
  const userContent = prompt.userPrompt ?? prompt.content;
  const content = applyPlaceholders(userContent, placeholders, projectTopic);

  // Anthropic ephemeral cache: when userPrompt is set, prompt.content is the
  // static system prompt — cache it across calls within the 5-min TTL window.
  const isAnthropic = getProviderForModel(model) === "anthropic";
  const useCache = isAnthropic && !!prompt.userPrompt;

  // Apply placeholders to system prompt when using metaprompt pattern
  let appliedSystemPrompt = effectiveSystemPrompt;
  if (prompt.userPrompt) {
    appliedSystemPrompt = applyPlaceholders(effectiveSystemPrompt, placeholders, projectTopic);
  }

  // Compose system prompt with editorial context
  let systemPromptForCall: string;
  let cachedForCall: string | undefined;

  if (useCache) {
    cachedForCall = appliedSystemPrompt;
    systemPromptForCall = editorialContext ?? "";
  } else {
    systemPromptForCall = editorialContext
      ? appliedSystemPrompt + "\n\n" + editorialContext
      : appliedSystemPrompt;
  }

  const baseOptions = {
    model,
    systemPrompt: systemPromptForCall,
    userPrompt: content,
    ...(useCache
      ? { cachedSystemPrompt: cachedForCall, cacheSystemPrompt: true }
      : {}),
    ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
    ...(params.maxTokens !== undefined ? { maxTokens: params.maxTokens } : {}),
    ...(effort !== undefined ? { effort } : {}),
    ...(signal !== undefined ? { signal } : {}),
  };

  let rawText: string;
  let usage: { promptTokens: number; completionTokens: number; costUsd?: number; cacheCreationTokens: number; cacheReadTokens: number };
  let durationMs = 0;

  if (params.schema) {
    const result = await generateCompletion({ ...baseOptions, schema: params.schema } as Parameters<typeof generateCompletion>[0]);
    rawText = JSON.stringify(result.data);
    usage = result.usage;
    durationMs = result.durationMs;
  } else {
    const result = await generateCompletion(baseOptions as Parameters<typeof generateCompletion>[0]);
    rawText = result.data as string;
    usage = result.usage;
    durationMs = result.durationMs;
  }

  // Check generated fragment for contamination.
  const text = stripPlaceholderWrappers(rawText);
  assertOriginalEnough(text, { stage: "fragment", throwOnFail: true });

  return {
    text,
    model,
    provider: getProviderForModel(model),
    durationMs,
    usage: {
      inputTokens: usage.promptTokens,
      outputTokens: usage.completionTokens,
      costUsd: usage.costUsd,
      cacheCreationTokens: usage.cacheCreationTokens,
      cacheReadTokens: usage.cacheReadTokens,
    },
  };
}

// ---------------------------------------------------------------------------
// Assembly types and helpers
// ---------------------------------------------------------------------------

export interface AssemblyGenerationOptions {
  assemblyPrompt: PromptLike;
  fragments: Array<{ title?: string; content: string }>;
  placeholders: Record<string, string>;
  model?: string;
  temperature?: number;
  effort?: ReasoningEffort;
  maxTokens?: number;
  projectTopic?: string | null;
  editorialContext?: string | null;
}

async function mergeTwoFragments(
  a: { title?: string; content: string },
  b: { title?: string; content: string },
  options: AssemblyGenerationOptions,
): Promise<GenerateResult> {
  const {
    assemblyPrompt,
    placeholders,
    model = DEFAULT_GENERATION_MODEL,
    temperature,
    effort,
    maxTokens,
    projectTopic,
    editorialContext,
  } = options;

  const baseSystemPrompt = assemblyPrompt.userPrompt
    ? assemblyPrompt.content
    : "";
  const systemPrompt = baseSystemPrompt
    ? `Eres un editor senior que ensambla capítulos de no-ficción en español. Aplica estas reglas de estilo al ensamblar el texto:\n\n${STYLE_RULES}\n\n---\n\n${baseSystemPrompt}`
    : `Eres un editor senior que ensambla capítulos de no-ficción en español. Aplica estas reglas de estilo al ensamblar el texto:\n\n${STYLE_RULES}`;
  let userContent = assemblyPrompt.userPrompt ?? assemblyPrompt.content;

  userContent = applyPlaceholders(userContent, placeholders, projectTopic);

  // {{SECCIONES_GENERADAS}} → XML format
  const fragmentsXml = `<secciones>\n<seccion id="1" nombre="${escapeXmlAttr(a.title || "Bloque 1")}">\n${escapeXmlText(a.content)}\n</seccion>\n<seccion id="2" nombre="${escapeXmlAttr(b.title || "Bloque 2")}">\n${escapeXmlText(b.content)}\n</seccion>\n</secciones>`;
  const fragmentsText = `### Fragment 1\n\n${a.content}\n\n---\n\n### Fragment 2\n\n${b.content}`;
  const assemblyMarkers =
    /\{\{SECCIONES_GENERADAS\}\}|\[PEGAR AQUÍ TODOS LOS FRAGMENTOS DEL CAPÍTULO\]|\[PASTE ALL CHAPTER FRAGMENTS HERE\]/;
  const hadAssemblyMarker = assemblyMarkers.test(userContent);
  userContent = userContent.replace(
    /\{\{SECCIONES_GENERADAS\}\}/g,
    fragmentsXml.replace(/\$/g, "$$$$"),
  );
  // Legacy markers
  userContent = userContent.replace(
    /\[PEGAR AQUÍ TODOS LOS FRAGMENTOS DEL CAPÍTULO\]|\[PASTE ALL CHAPTER FRAGMENTS HERE\]/g,
    fragmentsText.replace(/\$/g, "$$$$"),
  );
  // Fallback: if no marker was present, append fragments so the LLM
  // still sees the material to assemble (prevents silent empty output).
  if (!hadAssemblyMarker) {
    userContent += `\n\n---\n\n${fragmentsText}`;
  }

  const effectiveMaxTokens = maxTokens ?? assemblyMaxTokens(2, model);

  // Anthropic ephemeral cache: the system prompt (STYLE_RULES + assemblyPrompt.content)
  // is static across all merge calls in a chapter. Cache it to avoid re-sending every merge.
  const isAnthropic = getProviderForModel(model) === "anthropic";
  const useCache = isAnthropic && !!assemblyPrompt.userPrompt;

  // Compose system prompt with editorial context
  let systemPromptForCall: string;
  let cachedForCall: string | undefined;

  if (useCache) {
    cachedForCall = systemPrompt;
    systemPromptForCall = editorialContext ?? "";
  } else {
    systemPromptForCall = editorialContext
      ? systemPrompt + "\n\n" + editorialContext
      : systemPrompt;
  }

  const result = await generateCompletion({
    model,
    systemPrompt: systemPromptForCall,
    userPrompt: userContent,
    maxTokens: effectiveMaxTokens,
    ...(useCache
      ? { cachedSystemPrompt: cachedForCall, cacheSystemPrompt: true }
      : {}),
    ...(temperature !== undefined ? { temperature } : {}),
    ...(effort !== undefined ? { effort } : {}),
  });

  return {
    text: stripPlaceholderWrappers(result.data as string),
    model,
    provider: getProviderForModel(model),
    durationMs: result.durationMs,
    usage: {
      inputTokens: result.usage.promptTokens,
      outputTokens: result.usage.completionTokens,
      costUsd: result.usage.costUsd,
      cacheCreationTokens: result.usage.cacheCreationTokens,
      cacheReadTokens: result.usage.cacheReadTokens,
    },
  };
}

export async function generateChapterAssemblyHierarchical(
  options: AssemblyGenerationOptions,
): Promise<GenerateResult> {
  const {
    assemblyPrompt,
    fragments,
    placeholders,
    model = DEFAULT_GENERATION_MODEL,
    temperature,
    effort,
    maxTokens,
    projectTopic,
  } = options;

  if (fragments.length === 0) {
    throw new Error("No fragments to assemble");
  }

  if (fragments.length === 1) {
    return {
      text: fragments[0].content,
      model,
      provider: getProviderForModel(model),
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  }

  // Build merge tree bottom-up
  let currentLevel: Array<{ title?: string; content: string }> = fragments.map(
    (f) => ({ title: f.title, content: f.content }),
  );
  const totalUsage = { inputTokens: 0, outputTokens: 0 };

  while (currentLevel.length > 1) {
    const nextLevel: Array<{ title?: string; content: string }> = [];

    for (let i = 0; i < currentLevel.length; i += 2) {
      if (i + 1 < currentLevel.length) {
        const result = await mergeTwoFragments(
          currentLevel[i],
          currentLevel[i + 1],
          options,
        );
        nextLevel.push({ content: result.text });
        totalUsage.inputTokens += result.usage.inputTokens;
        totalUsage.outputTokens += result.usage.outputTokens;
      } else {
        nextLevel.push(currentLevel[i]);
      }
    }

    currentLevel = nextLevel;
  }

  const hierarchicalText = currentLevel[0].content;
  assertOriginalEnough(hierarchicalText, { stage: "assembly", throwOnFail: true });

  return {
    text: hierarchicalText,
    model,
    provider: getProviderForModel(model),
    usage: totalUsage,
  };
}

export async function generateChapterAssemblyHalves(
  options: AssemblyGenerationOptions,
): Promise<GenerateResult> {
  const {
    assemblyPrompt,
    fragments,
    placeholders,
    model = DEFAULT_GENERATION_MODEL,
    temperature,
    effort,
    maxTokens,
    projectTopic,
  } = options;

  if (fragments.length === 0) {
    throw new Error("No fragments to assemble");
  }

  if (fragments.length === 1) {
    return {
      text: fragments[0].content,
      model,
      provider: getProviderForModel(model),
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  }

  if (fragments.length === 2) {
    return mergeTwoFragments(
      fragments[0],
      fragments[1],
      options,
    );
  }

  const totalUsage = { inputTokens: 0, outputTokens: 0 };

  // Split into two roughly equal halves
  const mid = Math.floor(fragments.length / 2);
  const leftFragments = fragments.slice(0, mid);
  const rightFragments = fragments.slice(mid);

  // Assemble each half in one shot using the full assembly prompt
  const assembleHalf = async (
    half: { title?: string; content: string }[],
  ): Promise<{
    text: string;
    usage: { inputTokens: number; outputTokens: number };
  }> => {
    if (half.length === 1) {
      return {
        text: half[0].content,
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    }
    const result = await generateChapterAssembly({
      ...options,
      fragments: half,
    });
    return { text: result.text, usage: result.usage };
  };

  const leftResult = await assembleHalf(leftFragments);
  totalUsage.inputTokens += leftResult.usage.inputTokens;
  totalUsage.outputTokens += leftResult.usage.outputTokens;

  const rightResult = await assembleHalf(rightFragments);
  totalUsage.inputTokens += rightResult.usage.inputTokens;
  totalUsage.outputTokens += rightResult.usage.outputTokens;

  // Merge the two assembled halves
  const merged = await mergeTwoFragments(
    { content: leftResult.text },
    { content: rightResult.text },
    options,
  );
  totalUsage.inputTokens += merged.usage.inputTokens;
  totalUsage.outputTokens += merged.usage.outputTokens;

  const halvesText = merged.text;
  assertOriginalEnough(halvesText, { stage: "assembly", throwOnFail: true });

  return {
    text: halvesText,
    model,
    provider: getProviderForModel(model),
    usage: totalUsage,
  };
}

export type AssemblyAlgorithm = "merge-sort" | "sequential" | "halves";

export async function generateChapterAssemblySequential(
  options: AssemblyGenerationOptions,
): Promise<GenerateResult> {
  const {
    assemblyPrompt,
    fragments,
    placeholders,
    model = DEFAULT_GENERATION_MODEL,
    temperature,
    effort,
    maxTokens,
    projectTopic,
  } = options;

  if (fragments.length === 0) {
    throw new Error("No fragments to assemble");
  }

  if (fragments.length === 1) {
    return {
      text: fragments[0].content,
      model,
      provider: getProviderForModel(model),
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  }

  let accumulator = { content: fragments[0].content };
  const totalUsage = { inputTokens: 0, outputTokens: 0 };

  for (let i = 1; i < fragments.length; i++) {
    const result = await mergeTwoFragments(
      accumulator,
      { title: fragments[i].title, content: fragments[i].content },
      options,
    );
    accumulator = { content: result.text };
    totalUsage.inputTokens += result.usage.inputTokens;
    totalUsage.outputTokens += result.usage.outputTokens;
  }

  const sequentialText = accumulator.content;
  assertOriginalEnough(sequentialText, { stage: "assembly", throwOnFail: true });

  return {
    text: sequentialText,
    model,
    provider: getProviderForModel(model),
    usage: totalUsage,
  };
}

export async function generateChapterAssembly(
  options: AssemblyGenerationOptions,
): Promise<GenerateResult> {
  const {
    assemblyPrompt,
    fragments,
    placeholders,
    model = DEFAULT_GENERATION_MODEL,
    temperature,
    effort,
    maxTokens,
    projectTopic,
    editorialContext,
  } = options;
  // Legacy format (### Fragment N) — used by old markers
  const fragmentsText = fragments
    .map((f, i) => `### Fragment ${i + 1}\n\n${f.content}`)
    .join("\n\n---\n\n");

  // XML format with names — used by {{SECCIONES_GENERADAS}}
  const fragmentsXml = `<secciones>\n${fragments
    .map(
      (f, i) =>
        `<seccion id="${i + 1}" nombre="${escapeXmlAttr(f.title || `Bloque ${i + 1}`)}">\n${escapeXmlText(f.content)}\n</seccion>`,
    )
    .join("\n")}\n</secciones>`;

  // Assembly prompts from /assemblies always have userPrompt set.
  // content = system prompt, userPrompt = user message.
  const baseSystemPrompt = assemblyPrompt.userPrompt
    ? assemblyPrompt.content
    : "";
  let effectiveSystemPrompt = baseSystemPrompt
    ? `Eres un editor senior que ensambla capítulos de no-ficción en español. Aplica estas reglas de estilo al ensamblar el texto:\n\n${STYLE_RULES}\n\n---\n\n${baseSystemPrompt}`
    : `Eres un editor senior que ensambla capítulos de no-ficción en español. Aplica estas reglas de estilo al ensamblar el texto:\n\n${STYLE_RULES}`;
  const userContent = assemblyPrompt.userPrompt ?? assemblyPrompt.content;

  // Apply placeholders to system prompt when using metaprompt pattern
  if (assemblyPrompt.userPrompt) {
    effectiveSystemPrompt = applyPlaceholders(effectiveSystemPrompt, placeholders, projectTopic);
  }

  let content = applyPlaceholders(userContent, placeholders, projectTopic);

  // {{SECCIONES_GENERADAS}} → XML format with prompt titles
  // Escape $ in replacement to prevent special pattern interpretation ($&, $1, etc.)
  const assemblyMarkers =
    /\{\{SECCIONES_GENERADAS\}\}|\[PEGAR AQUÍ TODOS LOS FRAGMENTOS DEL CAPÍTULO\]|\[PASTE ALL CHAPTER FRAGMENTS HERE\]/;
  const hadAssemblyMarker = assemblyMarkers.test(content);
  content = content.replace(
    /\{\{SECCIONES_GENERADAS\}\}/g,
    fragmentsXml.replace(/\$/g, "$$$$"),
  );

  // Legacy markers → old format (backward compat)
  content = content.replace(
    /\[PEGAR AQUÍ TODOS LOS FRAGMENTOS DEL CAPÍTULO\]|\[PASTE ALL CHAPTER FRAGMENTS HERE\]/g,
    fragmentsText.replace(/\$/g, "$$$$"),
  );
  // Fallback: if no marker was present, append fragments so the LLM
  // still sees the material to assemble (prevents silent empty output).
  if (!hadAssemblyMarker) {
    content += `\n\n---\n\n${fragmentsText}`;
  }

  const effectiveMaxTokens = maxTokens ?? assemblyMaxTokens(fragments.length, model);

  // Anthropic ephemeral cache: system prompt (assemblyPrompt.content) is static
  const isAnthropic = getProviderForModel(model) === "anthropic";
  const useCache = isAnthropic && !!assemblyPrompt.userPrompt;

  // Compose system prompt with editorial context
  let systemPromptForCall: string;
  let cachedForCall: string | undefined;

  if (useCache) {
    cachedForCall = effectiveSystemPrompt;
    systemPromptForCall = editorialContext ?? "";
  } else {
    systemPromptForCall = editorialContext
      ? effectiveSystemPrompt + "\n\n" + editorialContext
      : effectiveSystemPrompt;
  }

  const result = await generateCompletion({
    model,
    systemPrompt: systemPromptForCall,
    userPrompt: content,
    maxTokens: effectiveMaxTokens,
    ...(useCache
      ? { cachedSystemPrompt: cachedForCall, cacheSystemPrompt: true }
      : {}),
    ...(temperature !== undefined ? { temperature } : {}),
    ...(effort !== undefined ? { effort } : {}),
  });

  const assemblyText = stripPlaceholderWrappers(result.data as string);

  assertOriginalEnough(assemblyText, { stage: "assembly", throwOnFail: true });

  return {
    text: assemblyText,
    model,
    provider: getProviderForModel(model),
    durationMs: result.durationMs,
    usage: {
      inputTokens: result.usage.promptTokens,
      outputTokens: result.usage.completionTokens,
      costUsd: result.usage.costUsd,
      cacheCreationTokens: result.usage.cacheCreationTokens,
      cacheReadTokens: result.usage.cacheReadTokens,
    },
  };
}

// ---------------------------------------------------------------------------
// Critique and correction
// ---------------------------------------------------------------------------

export interface GenerateCritiqueParams {
  critiquePrompt: PromptLike;
  content: string;
  placeholders: Record<string, string>;
  model?: string;
  temperature?: number;
  effort?: ReasoningEffort;
  maxTokens?: number;
  projectTopic?: string | null;
  /** Editorial brief context rendered as XML. Injected into system prompt with Anthropic cache split. */
  editorialContext?: string | null;
  /** Per-call abort signal. Set below Trigger task maxDuration so errors are caught before hard kill. */
  signal?: AbortSignal;
}

/** Critique output scales with content length. Each ~1024 chars contributes ~1024 tokens. */
function critiqueMaxTokens(contentLength: number): number {
  return Math.max(8192, Math.ceil(contentLength / 4) + 4096);
}

export async function generateChapterCritique(
  params: GenerateCritiqueParams,
): Promise<GenerateResult> {
  const {
    critiquePrompt,
    content: chapterContent,
    placeholders,
    model = DEFAULT_GENERATION_MODEL,
    temperature,
    effort,
    maxTokens,
    projectTopic,
    editorialContext,
    signal,
  } = params;

  const baseSystemPrompt = critiquePrompt.userPrompt
    ? critiquePrompt.content
    : "";
  let effectiveSystemPrompt = baseSystemPrompt
    ? `Eres un crítico editorial. Al evaluar el texto, usa estas reglas de estilo como criterio de calidad:\n\n${STYLE_RULES}\n\n---\n\n${baseSystemPrompt}`
    : `Eres un crítico editorial. Al evaluar el texto, usa estas reglas de estilo como criterio de calidad:\n\n${STYLE_RULES}`;
  const userContent = critiquePrompt.userPrompt ?? critiquePrompt.content;

  let processedUserContent = applyPlaceholders(
    userContent,
    placeholders,
    projectTopic,
  );

  // Replace content placeholder with the actual chapter content
  const critiqueMarkers =
    /\{\{CONTENIDO_CAPITULO\}\}|\[PEGAR AQUÍ EL CAPÍTULO A CRITICAR\]|\[PEGAR AQUÍ EL CAPÍTULO COMPLETO\]/g;
  const hadCritiqueMarker = critiqueMarkers.test(processedUserContent);
  processedUserContent = processedUserContent.replace(
    /\{\{CONTENIDO_CAPITULO\}\}/g,
    chapterContent.replace(/\$/g, "$$$$"),
  );
  processedUserContent = processedUserContent.replace(
    /\[PEGAR AQUÍ EL CAPÍTULO A CRITICAR\]|\[PEGAR AQUÍ EL CAPÍTULO COMPLETO\]/g,
    chapterContent.replace(/\$/g, "$$$$"),
  );
  // Fallback: if no marker was present, append chapter content so the LLM
  // still sees the material to critique (prevents silent empty output).
  if (!hadCritiqueMarker) {
    processedUserContent +=
      `\n\n---\n\n[Capítulo a criticar]\n\n${chapterContent}`;
  }

  const effectiveMaxTokens =
    maxTokens ?? critiqueMaxTokens(chapterContent.length);

  // Anthropic ephemeral cache: when userPrompt is set, critiquePrompt.content
  // is the static system prompt — cache it across critique calls.
  const isAnthropic = getProviderForModel(model) === "anthropic";
  const useCache = isAnthropic && !!critiquePrompt.userPrompt;

  // Apply placeholders to system prompt when using metaprompt pattern
  if (critiquePrompt.userPrompt) {
    effectiveSystemPrompt = applyPlaceholders(effectiveSystemPrompt, placeholders, projectTopic);
  }

  // Compose system prompt with editorial context
  let systemPromptForCall: string;
  let cachedForCall: string | undefined;

  if (useCache) {
    cachedForCall = effectiveSystemPrompt;
    systemPromptForCall = editorialContext ?? "";
  } else {
    systemPromptForCall = editorialContext
      ? effectiveSystemPrompt + "\n\n" + editorialContext
      : effectiveSystemPrompt;
  }

  const result = await generateCompletion({
    model,
    systemPrompt: systemPromptForCall,
    userPrompt: processedUserContent,
    maxTokens: effectiveMaxTokens,
    ...(useCache
      ? { cachedSystemPrompt: cachedForCall, cacheSystemPrompt: true }
      : {}),
    ...(temperature !== undefined ? { temperature } : {}),
    ...(effort !== undefined ? { effort } : {}),
    ...(signal !== undefined ? { signal } : {}),
  });

  const critiqueText = stripPlaceholderWrappers(result.data as string);

  // Non-blocking: critique is meta-text, not published content
  assertOriginalEnough(critiqueText, { stage: "critique", throwOnFail: false });

  return {
    text: critiqueText,
    model,
    provider: getProviderForModel(model),
    durationMs: result.durationMs,
    usage: {
      inputTokens: result.usage.promptTokens,
      outputTokens: result.usage.completionTokens,
      costUsd: result.usage.costUsd,
      cacheCreationTokens: result.usage.cacheCreationTokens,
      cacheReadTokens: result.usage.cacheReadTokens,
    },
  };
}

export interface GenerateCorrectionParams {
  correctorPrompt: PromptLike;
  content: string;
  critiqueContent: string;
  placeholders: Record<string, string>;
  model?: string;
  temperature?: number;
  effort?: ReasoningEffort;
  maxTokens?: number;
  projectTopic?: string | null;
  /** Editorial brief context rendered as XML. Injected into system prompt with Anthropic cache split. */
  editorialContext?: string | null;
  /** Per-call abort signal. Set below Trigger task maxDuration so errors are caught before hard kill. */
  signal?: AbortSignal;
}

export async function generateChapterCorrection(
  params: GenerateCorrectionParams,
): Promise<GenerateResult> {
  const {
    correctorPrompt,
    content: chapterContent,
    critiqueContent,
    placeholders,
    model = DEFAULT_GENERATION_MODEL,
    temperature,
    effort,
    maxTokens,
    projectTopic,
    editorialContext,
    signal,
  } = params;

  const baseSystemPrompt = correctorPrompt.userPrompt
    ? correctorPrompt.content
    : "";
  let effectiveSystemPrompt = baseSystemPrompt
    ? `Eres un corrector editorial. Al reescribir el texto, aplica estas reglas de estilo:\n\n${STYLE_RULES}\n\n---\n\n${baseSystemPrompt}`
    : `Eres un corrector editorial. Al reescribir el texto, aplica estas reglas de estilo:\n\n${STYLE_RULES}`;
  const userContent = correctorPrompt.userPrompt ?? correctorPrompt.content;

  let processedUserContent = applyPlaceholders(
    userContent,
    placeholders,
    projectTopic,
  );

  // Replace content placeholders
  const correctionMarkers =
    /\{\{CONTENIDO_CAPITULO\}\}|\{\{CONTENIDO_CRITICA\}\}/g;
  const hadCorrectionMarker = correctionMarkers.test(processedUserContent);
  processedUserContent = processedUserContent.replace(
    /\{\{CONTENIDO_CAPITULO\}\}/g,
    chapterContent.replace(/\$/g, "$$$$"),
  );
  processedUserContent = processedUserContent.replace(
    /\{\{CONTENIDO_CRITICA\}\}/g,
    critiqueContent.replace(/\$/g, "$$$$"),
  );
  // Fallback: if no marker was present, append chapter + critique content
  // so the LLM still sees the material to correct (prevents silent empty output).
  if (!hadCorrectionMarker) {
    processedUserContent +=
      `\n\n---\n\n[Capítulo a corregir]\n\n${chapterContent}\n\n[Crítica]\n\n${critiqueContent}`;
  }

  // Correction output scales with input (chapter + critique)
  const inputLength = chapterContent.length + critiqueContent.length;
  const effectiveMaxTokens =
    maxTokens ?? Math.max(8192, Math.ceil(inputLength / 4) + 8192);

  // Anthropic ephemeral cache
  const isAnthropic = getProviderForModel(model) === "anthropic";
  const useCache = isAnthropic && !!correctorPrompt.userPrompt;

  // Apply placeholders to system prompt when using metaprompt pattern
  if (correctorPrompt.userPrompt) {
    effectiveSystemPrompt = applyPlaceholders(effectiveSystemPrompt, placeholders, projectTopic);
  }

  // Anthropic ephemeral cache — split static (cached) from dynamic editorial context
  let systemPromptForCall: string;
  let cachedForCall: string | undefined;
  if (useCache) {
    cachedForCall = effectiveSystemPrompt;
    systemPromptForCall = editorialContext ?? "";
  } else {
    systemPromptForCall = editorialContext
      ? effectiveSystemPrompt + "\n\n" + editorialContext
      : effectiveSystemPrompt;
  }

  const result = await generateCompletion({
    model,
    systemPrompt: systemPromptForCall,
    userPrompt: processedUserContent,
    maxTokens: effectiveMaxTokens,
    ...(cachedForCall ? { cachedSystemPrompt: cachedForCall, cacheSystemPrompt: true } : {}),
    ...(temperature !== undefined ? { temperature } : {}),
    ...(effort !== undefined ? { effort } : {}),
    ...(signal !== undefined ? { signal } : {}),
  });

  const correctionText = stripPlaceholderWrappers(result.data as string);

  assertOriginalEnough(correctionText, { stage: "correction", throwOnFail: true });

  return {
    text: correctionText,
    model,
    provider: getProviderForModel(model),
    durationMs: result.durationMs,
    usage: {
      inputTokens: result.usage.promptTokens,
      outputTokens: result.usage.completionTokens,
      costUsd: result.usage.costUsd,
      cacheCreationTokens: result.usage.cacheCreationTokens,
      cacheReadTokens: result.usage.cacheReadTokens,
    },
  };
}
