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
      if (!isAddressInUse(err)) throw err;
    }
  }

  throw new Error(
    `Could not bind a port in the range ${preferred}..${preferred + MAX_PORT_ATTEMPTS - 1}. Last error: ${String(lastError)}`
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

function isAddressInUse(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as NodeJS.ErrnoException).code === "EADDRINUSE"
  );
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
