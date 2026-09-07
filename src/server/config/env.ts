import dotenv from "dotenv";
import fs from "fs";
import path from "path";

export function loadEnv(): void {
  const local = path.join(process.cwd(), ".env.local");
  if (fs.existsSync(local)) {
    dotenv.config({ path: local });
  }
  dotenv.config();
}

export function isPlaceholder(val: string | undefined): boolean {
  if (!val) return true;
  const trimmed = val.trim().replace(/^["']|["']$/g, "");
  const placeholders = [
    "MY_GEMINI_API_KEY",
    "YOUR_GEMINI_API_KEY",
    "YOUR_API_KEY",
    "ENTER_YOUR_KEY_HERE",
    "undefined",
    "null",
    "",
  ];
  return !trimmed || placeholders.includes(trimmed) || trimmed.length < 10;
}

export function maskKey(key: string | undefined): string {
  if (!key) return "None";
  if (key.length < 8) return "***";
  return `${key.substring(0, 4)}...${key.substring(key.length - 4)}`;
}

// Gemini-only key discovery. Stage 2 generalises this via the LLM registry.
export function findGeminiKey(): { key: string; source: string } {
  if (process.env.GEMINI_API_KEY && !isPlaceholder(process.env.GEMINI_API_KEY)) {
    return { key: process.env.GEMINI_API_KEY.trim(), source: "GEMINI_API_KEY" };
  }
  if (process.env.API_KEY && !isPlaceholder(process.env.API_KEY)) {
    return { key: process.env.API_KEY.trim(), source: "API_KEY" };
  }
  return { key: "", source: "None" };
}
