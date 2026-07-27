import { CohereClient } from "cohere-ai";
import { ensureEnvLoaded } from "./load-env";

let client: CohereClient | null = null;

export function getCohereClient(): CohereClient {
  ensureEnvLoaded();

  if (!client) {
    const apiKey = process.env.COHERE_API_KEY;
    if (!apiKey) throw new Error("COHERE_API_KEY environment variable is required");
    client = new CohereClient({ token: apiKey });
  }
  return client;
}
