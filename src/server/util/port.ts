import http from "http";
import fs from "fs";
import path from "path";

const RUNTIME_PORT_FILE = path.join(process.cwd(), ".port-runtime");
const MAX_PORT_ATTEMPTS = 20;

export interface BoundPort {
  server: http.Server;
  port: number;
}

// Try to bind starting at `preferred`. On EADDRINUSE, increment up to
// MAX_PORT_ATTEMPTS times. The bound port is handed back to the caller, and
// index.ts opens the browser on it — nothing re-reads it from disk. The
// `.port-runtime` file is written for OTHER tools (the Foundry module probes
// the same bounded range because it cannot read that file across a network).
export async function bindWithFallback(
  app: import("express").Express,
  preferred: number,
  host = "127.0.0.1"
): Promise<BoundPort> {
  let lastError: unknown;

  for (let offset = 0; offset < MAX_PORT_ATTEMPTS; offset++) {
    const candidate = preferred + offset;
    try {
      const server = await tryBind(app, candidate, host);
      writeRuntimePort(candidate);
      if (offset > 0) {
        console.warn(`Port ${preferred} was busy — bound to ${candidate} instead.`);
      }
      return { server, port: candidate };
    } catch (err) {
      lastError = err;
      if (!isPortUnavailable(err)) throw err;
    }
  }

  // An EACCES on the last attempt almost always means the whole range sits
  // inside a Windows reserved block rather than that twenty programs are
  // listening — say so, because the fix (pick a different PORT) is not what
  // "could not bind" suggests on its own.
  // Platform-gated, because the two EACCES causes have nothing in common and
  // the wrong advice is worse than none: on POSIX it means privileged ports,
  // and telling that user to run a `netsh` command sends them nowhere.
  let reserved = "";
  if ((lastError as NodeJS.ErrnoException | undefined)?.code === "EACCES") {
    reserved =
      process.platform === "win32"
        ? "\nOn Windows this range may be reserved by Hyper-V, WSL2 or Docker Desktop. " +
          "Check with:  netsh interface ipv4 show excludedportrange protocol=tcp\n" +
          "Then set a port outside those ranges in .env.local, e.g.  PORT=3500"
        : "\nPorts below 1024 need root on this platform. " +
          "Set a higher port in .env.local, e.g.  PORT=3500";
  }

  throw new Error(
    `Could not bind a port in the range ${preferred}..${preferred + MAX_PORT_ATTEMPTS - 1}. ` +
      `Last error: ${String(lastError)}${reserved}`
  );
}

function tryBind(
  app: import("express").Express,
  port: number,
  host: string
): Promise<http.Server> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    const onError = (err: NodeJS.ErrnoException) => {
      server.removeListener("listening", onListening);
      reject(err);
    };
    const onListening = () => {
      server.removeListener("error", onError);
      resolve(server);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}

/**
 * Is this the kind of bind failure that the NEXT port might survive?
 *
 * EADDRINUSE is the obvious one: something else holds the port.
 *
 * EACCES matters just as much on Windows, and used to abort the whole walk.
 * Windows reserves blocks of TCP ports for Hyper-V, WSL2 and Docker Desktop
 * (`netsh interface ipv4 show excludedportrange protocol=tcp`), and binding
 * inside a reserved block fails with EACCES, not EADDRINUSE. A user whose
 * reservation happened to cover 3000 got a hard `listen EACCES` on the first
 * attempt and the remaining nineteen candidates were never tried — the exact
 * situation the fallback exists for. Retrying is also correct on POSIX, where
 * EACCES means a privileged port (<1024) and the next candidate is usually
 * fine too.
 *
 * Anything else — EADDRNOTAVAIL from a bad HOST, for instance — still throws
 * immediately: walking twenty ports cannot fix an address that does not exist,
 * and the real error is more useful than a range summary.
 */
function isPortUnavailable(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const code = (err as NodeJS.ErrnoException).code;
  return code === "EADDRINUSE" || code === "EACCES";
}

function writeRuntimePort(port: number): void {
  try {
    fs.writeFileSync(RUNTIME_PORT_FILE, String(port));
  } catch (err) {
    console.warn("Could not write .port-runtime:", err);
  }
}

export function cleanupRuntimePort(): void {
  try {
    if (fs.existsSync(RUNTIME_PORT_FILE)) fs.unlinkSync(RUNTIME_PORT_FILE);
  } catch {
    /* ignore */
  }
}
