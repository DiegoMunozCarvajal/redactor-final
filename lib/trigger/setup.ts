import { configure } from "@trigger.dev/sdk/v3";
import { loadEnvFile } from "@/lib/env";

loadEnvFile(".env");

const accessToken = process.env.TRIGGER_SECRET_KEY;
const baseURL = process.env.TRIGGER_API_URL;

if (!accessToken) {
  throw new Error("TRIGGER_SECRET_KEY is not set. Check your .env file.");
}

configure({ accessToken, ...(baseURL ? { baseURL } : {}) });
