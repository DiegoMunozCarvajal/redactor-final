import { GoogleGenAI } from "@google/genai";

let client: GoogleGenAI | null = null;

export function getGoogleClient(): GoogleGenAI {
  if (!client) {
    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) throw new Error("GOOGLE_API_KEY environment variable is required");
    client = new GoogleGenAI({ apiKey });
  }
  return client;
}
