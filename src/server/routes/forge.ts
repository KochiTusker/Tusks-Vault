// POST /api/forge/build — turn the lore folder into a vault, streaming.
//
// loopbackOnly, like every other route that acts on the HOST: this one reads
// an arbitrary directory and writes a new one. Under the documented
// HOST=0.0.0.0 option a LAN visitor reaches the rest of the app by design;
// this would be a filesystem-write primitive.
//
// Streamed rather than a single response because forging a real campaign
// takes tens of seconds, and a button that appears to hang is a button people
// press twice.

import { Router } from "express";
import express from "express";
import { KNOWLEDGE_DIR } from "../config/paths";
import { loopbackOnly } from "../util/loopback-only";
import { runForge, targetIsSafe, type ForgeProgress } from "../forge/run";
import path from "node:path";

export const forgeRouter = Router();

forgeRouter.use("/api/forge", loopbackOnly());

/** What the button would do, without doing it. Lets the card show the target
 *  and refuse up front rather than after a user has committed. */
forgeRouter.get("/api/forge/target", (_req, res) => {
  const outDir = path.join(KNOWLEDGE_DIR, "Vault");
  const safe = targetIsSafe(outDir);
  res.json({ loreDir: KNOWLEDGE_DIR, outDir, ok: safe.ok, reason: safe.reason ?? null });
});

forgeRouter.post("/api/forge/build", express.json({ limit: "10kb" }), async (req, res) => {
  const body = (req.body ?? {}) as { includeSessions?: boolean; force?: boolean };

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    // Without this an intermediary can buffer the whole stream and deliver it
    // at the end, which is exactly what the stream exists to avoid.
    "X-Accel-Buffering": "no",
  });

  const send = (event: string, data: unknown): void => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  // A client that navigates away must not leave the build writing into a
  // directory nobody is watching.
  let aborted = false;
  req.on("close", () => {
    aborted = true;
  });

  try {
    const result = await runForge(KNOWLEDGE_DIR, {
      includeSessions: body.includeSessions !== false,
      force: body.force === true,
      onProgress: (p: ForgeProgress) => {
        if (aborted) return;
        send("progress", p);
      },
    });
    send("done", result);
  } catch (err) {
    send("error", { message: (err as Error)?.message ?? String(err) });
  } finally {
    res.end();
  }
});
