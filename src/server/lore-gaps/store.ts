import fs from "fs";
import { LORE_GAPS_PATH } from "../config/paths";
import { LORE_GAP_TRIGGER_FRAGMENT } from "../prompt/system";

export interface LoreGap {
  id: string;
  question: string;
  timestamp: string;
  status: string;
}

export function getLoreGaps(): LoreGap[] {
  try {
    if (fs.existsSync(LORE_GAPS_PATH)) {
      return JSON.parse(fs.readFileSync(LORE_GAPS_PATH, "utf-8"));
    }
  } catch (err) {
    console.error("Error reading lore gaps:", err);
  }
  return [];
}

export function saveLoreGaps(gaps: LoreGap[]): void {
  fs.writeFileSync(LORE_GAPS_PATH, JSON.stringify(gaps, null, 2));
}

export function recordLoreGap(question: string): LoreGap {
  const gaps = getLoreGaps();
  const gap: LoreGap = {
    id: Date.now().toString(),
    question,
    timestamp: new Date().toISOString(),
    status: "pending",
  };
  gaps.push(gap);
  saveLoreGaps(gaps);
  return gap;
}

export function deleteLoreGap(id: string): void {
  const filtered = getLoreGaps().filter(g => g.id !== id);
  saveLoreGaps(filtered);
}

/** Updates the question text of an existing gap in place. The dashboard's
 *  "edit" button on the Lore Gaps card calls this so DMs can refine the
 *  recorded prompt without losing the linked status/timestamp. */
export function updateLoreGap(id: string, question: string): LoreGap | null {
  const gaps = getLoreGaps();
  const index = gaps.findIndex(g => g.id === id);
  if (index === -1) return null;
  gaps[index] = { ...gaps[index], question };
  saveLoreGaps(gaps);
  return gaps[index];
}

// Case-insensitive substring match so paraphrases from non-Gemini providers
// (Anthropic / OpenAI / Ollama tend to drop punctuation or rewrap the phrase
// in quotes) still trip the gap detector reliably.
//
// The one exception is a SPECULATIVE answer. Smaller models sometimes emit
// the lore-gap phrase and then speculate anyway, and the substring match then
// files "who is most likely to X" as something the DM must go and clarify —
// which they cannot, because a hypothetical has no canonical answer. A gap
// list full of those is a gap list nobody reads. The `[speculation]` tag is
// the model saying outright that it was not making a factual claim, so it is
// a reliable signal to skip.
export function responseContainsLoreGapTrigger(response: string): boolean {
  const lower = response.toLowerCase();
  if (!lower.includes(LORE_GAP_TRIGGER_FRAGMENT)) return false;
  return !lower.includes("[speculation]");
}
