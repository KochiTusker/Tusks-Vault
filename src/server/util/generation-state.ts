// Shared "an answer is being composed" signal.
//
// The Discord handler increments around each LLM call; /api/status reports
// `generating: activeGenerations > 0`; the dashboard mirrors it onto
// <html data-thinking> so the whole chrome responds while the scribe works
// (see the answer-reactive block in src/index.css). A counter rather than a
// boolean because two questions can arrive concurrently, and the first one
// finishing must not extinguish the signal while the second still runs.

let activeGenerations = 0;

export function generationStarted(): void {
  activeGenerations++;
}

export function generationFinished(): void {
  activeGenerations = Math.max(0, activeGenerations - 1);
}

export function isGenerating(): boolean {
  return activeGenerations > 0;
}
