import express, { type NextFunction, type Request, type Response } from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { installLogCapture } from "./util/log-capture";
import { loadEnv, findGeminiKey, maskKey } from "./config/env";
import { ensureKnowledgeDir } from "./knowledge/loader";
import { discordClient, loginDiscord } from "./discord/client";
import { registerDiscordHandlers } from "./surfaces/discord";
import { registerRoutes } from "./routes";
import { bindWithFallback, cleanupRuntimePort } from "./util/port";
import { openBrowser } from "./util/browser";
import { warmupEmbeddings } from "./embeddings/index";
import { backfillClarificationEmbeddings } from "./clarifications/retrieve";
import { listKeys } from "./keys/store";
import { warnIfNodeModulesStale } from "./util/updater";
import { hostOriginGuard } from "./util/host-origin-guard";
import { securityHeaders } from "./util/security-headers";

const DEFAULT_PORT = 3000;
// Bind to 127.0.0.1 by default so the dashboard / API isn't reachable from
// other devices on the user's network. Set HOST=0.0.0.0 in .env.local for
// the advanced case of intentionally exposing the UI (e.g. running on a NAS).
const DEFAULT_HOST = "127.0.0.1";

export async function startServer(): Promise<void> {
  installLogCapture();
  loadEnv();
  ensureKnowledgeDir();

  const { key, source } = findGeminiKey();
  if (key) {
    console.log(`Gemini API Key loaded from ${source}: (${maskKey(key)})`);
    if (!key.startsWith("AIza")) {
      console.warn(`WARNING: The API key from ${source} does not start with 'AIza'.`);
    }
  }

  // Touch the key store on startup so the "[keys] Loaded N key(s)..."
  // diagnostic appears in the log even before the user opens the dashboard.
  // Helps verify the key store is being read from the expected path.
  listKeys();

  registerDiscordHandlers();
  loginDiscord();

  // Pull the embedding model's cold-start cost forward so the first user-facing
  // query isn't ~3-5 s slower. Backfill runs after the model is ready (it
  // awaits the same lazy-loaded extractor).
  warmupEmbeddings();
  void backfillClarificationEmbeddings().catch(err =>
    console.warn("[embeddings] startup backfill failed:", err)
  );

  // Safety-net banner mirroring Tusks-Tomes: print a loud warning when
  // node_modules is older than package-lock.json. The in-app updater never
  // runs npm install for the user (avoids EPERM/EBUSY on Windows), so a user
  // who didn't notice the post-apply prompt gets reminded again here on
  // every boot until they actually run the install. Non-fatal — server
  // continues to start either way.
  void warnIfNodeModulesStale().catch(err =>
    console.warn("[updater] node_modules staleness check failed:", err)
  );

  const preferredPort = Number(process.env.PORT) || DEFAULT_PORT;
  const host = process.env.HOST || DEFAULT_HOST;

  const app = express();
  // Defense against DNS rebinding: reject requests whose Host header isn't a
  // loopback literal (when bound to 127.0.0.1), and reject non-GET writes
  // whose Origin/Referer is a non-loopback page. Installed BEFORE the route
  // table and the Vite middlewares so it covers every endpoint on the app.
  // The MCP endpoint and the two pre-trust pairing calls are exempted from the
  // guard's cross-origin WRITE check and nothing else — the Host check still
  // applies to them. They have to answer a Foundry page whose origin is not
  // loopback (a LAN box, a hosted world), and what replaces the check there is
  // narrower: mcp/auth.ts allows only origins that completed pairing.
  app.use(
    hostOriginGuard({
      bindHost: host,
      crossOriginPaths: ["/mcp", "/api/mcp/pair/request", "/api/mcp/pair/status"],
    })
  );
  // Defensive headers — clickjacking, MIME sniff, referrer leakage, and a
  // mode-aware Content-Security-Policy (lax in dev for Vite HMR, strict in
  // prod). Cheap and universal; runs before routes so every response carries
  // them.
  app.use(securityHeaders({ isDev: process.env.NODE_ENV !== "production" }));
  registerRoutes(app);

  const { server, port } = await bindWithFallback(app, preferredPort, host);

  if (process.env.NODE_ENV !== "production") {
    // Share the HTTP server with Vite's HMR WebSocket so we never need a
    // separate Vite port (24678 by default, which collides on busy machines).
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: { server } },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  // Terminal error handler. Registered last, because Express picks the
  // four-argument middleware that comes AFTER whatever threw.
  //
  // Without one, Express's default finalhandler serves `err.stack` in the
  // response body whenever NODE_ENV is not "production" — which, in this
  // project, is every install (`npm start` is `tsx server.ts`; nothing sets
  // the variable). Demonstrated: `POST /mcp` with the body `{{{` returned a
  // stack trace naming the absolute install directory. That is worse than it
  // sounds for two reasons. `express.json()` rejects a malformed or oversized
  // body BEFORE any route or auth runs, and `/mcp` is one of the three paths
  // deliberately exempted from the cross-origin guard — so any web page the
  // GM happens to visit could read the install path, which on a normal clone
  // under C:\Users\<name> or /home/<name> is the operator's account name.
  // Protecting that string in tracked files while serving it to strangers on
  // request is not a defence.
  //
  // The status code is preserved (400 for a bad body, 413 for too large) so
  // callers still learn what they did wrong; only the stack is withheld. The
  // log line is `err.message`, not `err.stack`, because run.log is read and
  // pasted into issues, and scrub-secrets.ts redacts credential shapes rather
  // than paths.
  app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) return next(err);
    const status =
      typeof err === "object" && err !== null && "status" in err &&
      typeof (err as { status: unknown }).status === "number"
        ? (err as { status: number }).status
        : 500;
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[error] ${status} ${message}`);
    res.status(status).json({
      error: status === 500 ? "Internal error." : message,
    });
  });

  const url = `http://localhost:${port}`;
  console.log(`Tusk's Vault running on ${url}`);
  if (discordClient.user) {
    console.log(`Discord client: ${discordClient.user.tag}`);
  }
  openBrowser(url);

  const shutdown = () => {
    cleanupRuntimePort();
    server.close(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
