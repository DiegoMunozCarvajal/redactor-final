import OpenAI from "openai";
import { ensureEnvLoaded } from "./load-env";

let client: OpenAI | null = null;

export function getOpenAIClient(): OpenAI {
  ensureEnvLoaded();

  if (!client) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY environment variable is required");
    client = new OpenAI({ apiKey });
  }
  return client;
}
