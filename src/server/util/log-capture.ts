import fs from "fs";
import { LOG_FILE_PATH } from "../config/paths";
import { scrubSecrets } from "./scrub-secrets";

const MAX_LOGS = 100;
const MAX_FILE_BYTES = 2 * 1024 * 1024; // 2 MB rolling — old half is truncated when crossed.
const TRUNCATE_INTERVAL_MS = 60_000;

export const logs: string[] = [];

const originalLog = console.log;
const originalError = console.error;
const originalWarn = console.warn;

function format(args: unknown[]): string {
  return args.map(a => typeof a === "object" ? JSON.stringify(a) : String(a)).join(" ");
}

// On-disk persistence uses a long-lived append-mode write stream instead of
// `fs.appendFileSync` so console-heavy code paths (every HTTP request) don't
// block the event loop on disk IO. The stream is opened lazily on first
// write and recreated transparently if it ever emits an error.
let stream: fs.WriteStream | null = null;

function getStream(): fs.WriteStream | null {
  if (stream) return stream;
  try {
    stream = fs.createWriteStream(LOG_FILE_PATH, { flags: "a" });
    // On error, reset to null so the next write retries opening the stream
    // (e.g. log dir was deleted out from under us — recreate on demand).
    stream.on("error", () => { stream = null; });
    return stream;
  } catch {
    return null;
  }
}

// End the live stream and null the module-local handle so the next record()
// reopens it lazily. Returns a Promise that resolves when the OS reports the
// stream closed — callers that need to read or rewrite the file should await
// it; fire-and-forget callers can ignore the return.
function closeStream(): Promise<void> {
  const s = stream;
  if (!s) return Promise.resolve();
  stream = null;
  return new Promise(resolve => s.end(() => resolve()));
}

function appendToFile(line: string): void {
  const s = getStream();
  if (!s) return;
  try {
    s.write(line + "\n");
  } catch {
    /* swallow — disk persistence is best-effort */
  }
}

// Truncation is racy if done inline on every write: two concurrent log lines
// can both see size > MAX and both rewrite. Move it to a single 60 s timer
// guarded by an `inFlight` flag so only one truncation runs at a time.
let truncating = false;
let truncateTimer: NodeJS.Timeout | null = null;

async function truncateIfTooLarge(): Promise<void> {
  if (truncating) return;
  truncating = true;
  try {
    const stat = await fs.promises.stat(LOG_FILE_PATH).catch(() => null);
    if (!stat || stat.size <= MAX_FILE_BYTES) return;
    // Close the live stream first so the rewrite isn't racing the writer
    // (the OS will queue our flush). Reopen lazily on the next record() call.
    await closeStream();
    const data = await fs.promises.readFile(LOG_FILE_PATH, "utf-8");
    const tail = data.slice(data.length - Math.floor(MAX_FILE_BYTES / 2));
    // Drop the partial line at the start so the truncated file still
    // line-parses cleanly.
    const firstNewline = tail.indexOf("\n");
    await fs.promises.writeFile(
      LOG_FILE_PATH,
      firstNewline === -1 ? tail : tail.slice(firstNewline + 1),
    );
  } catch {
    /* swallow — best effort */
  } finally {
    truncating = false;
  }
}

function startTruncateTimer(): void {
  if (truncateTimer) return;
  truncateTimer = setInterval(() => { void truncateIfTooLarge(); }, TRUNCATE_INTERVAL_MS);
  // Don't keep the process alive just for this timer — shutdown should exit
  // promptly even mid-interval.
  if (typeof truncateTimer.unref === "function") truncateTimer.unref();
}

function record(prefix: string, args: unknown[]): void {
  // Mask known secret shapes (API keys, Discord tokens) before they hit either
  // the in-memory ring or the on-disk file. Scrubbing here covers both
  // surfaces in one place — GET /api/logs reads `logs[]` and so gets the
  // scrubbed view automatically.
  const safeBody = scrubSecrets(format(args));
  const line = `${new Date().toISOString()} ${prefix} ${safeBody}`;
  logs.push(line);
  if (logs.length > MAX_LOGS) logs.shift();
  appendToFile(line);
}

export function installLogCapture(): void {
  console.log = (...args) => {
    record("[LOG]", args);
    originalLog(...args);
  };

  console.error = (...args) => {
    record("[ERROR]", args);
    originalError(...args);
  };

  console.warn = (...args) => {
    record("[WARN]", args);
    originalWarn(...args);
  };

  startTruncateTimer();
}

/** Clears both the in-memory ring and the on-disk log file. Used by the
 *  "Clear logs" button on the Home → Logs tab. */
export function clearAllLogs(): void {
  logs.length = 0;
  try {
    // Close the stream so the truncate write isn't racing the append stream.
    void closeStream();
    fs.writeFileSync(LOG_FILE_PATH, "");
  } catch {
    /* swallow */
  }
}

/** Test hook — stops the truncation interval so vitest can exit cleanly when
 *  a test boots the log capture. Not part of the public API. */
export function _stopTruncateTimerForTests(): void {
  if (truncateTimer) {
    clearInterval(truncateTimer);
    truncateTimer = null;
  }
  void closeStream();
}
