import OpenAI from "openai";

let deepseekClient: OpenAI | null = null;

export function getDeepSeekClient(): OpenAI {
  if (deepseekClient) return deepseekClient;

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error("Missing DEEPSEEK_API_KEY environment variable.");
  }

  deepseekClient = new OpenAI({
    apiKey,
    baseURL: "https://api.deepseek.com",
  });

  return deepseekClient;
}
