// Claude Code subscription provider — HTTP surface.
//
// Thin wrapper over llm/claude-code-cli.ts, which owns the spawn, the env
// strip, the sandbox cwd, and the failure taxonomy. This file only maps
// ClaudeCodeError.kind onto status codes; the Discord path calls the same
// function directly rather than looping back through here.

import { Router } from "express";
import express from "express";
import {
  ClaudeCodeError,
  claudeCodeStatus,
  runClaudeCode,
} from "../llm/claude-code-cli";
import { loopbackOnly } from "../util/loopback-only";

export const claudeCodeRouter = Router();

// loopbackOnly: `?force=1` bypasses the status cache (claude-code-cli.ts:145),
// so every call spawns `claude --version` on the HOST. It is a GET, so
// hostOriginGuard's Origin check — which only applies to writes — never fires.
// Ungated, under HOST=0.0.0.0 that is an unbounded process-spawn amplifier and
// discloses whether the owner has the CLI and is signed in.
claudeCodeRouter.get("/api/claude-code/status", loopbackOnly(), async (req, res) => {
  try {
    res.json(await claudeCodeStatus(req.query.force === "1"));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// loopbackOnly: this spawns a process on the HOST. Under HOST=0.0.0.0 a LAN
// visitor reaches every other route by design; they must not reach this one.
claudeCodeRouter.post(
  "/api/claude-code/generate",
  loopbackOnly(),
  express.json({ limit: "2mb" }),
  async (req, res) => {
    const { model, prompt } = (req.body ?? {}) as { model?: string; prompt?: string };

    // Kill the child only on a GENUINE client abort. Listen on `res` close,
    // NOT `req` close — the latter fires the instant express.json() finishes
    // consuming the body, which would kill the CLI before it produced a byte.
    let abort: (() => void) | null = null;
    res.on("close", () => {
      if (!res.writableEnded) abort?.();
    });

    try {
      const result = await runClaudeCode({
        model,
        prompt: prompt as string,
        onSpawn: kill => { abort = kill; },
      });
      res.json(result);
    } catch (err) {
      if (res.writableEnded) return;
      if (!(err instanceof ClaudeCodeError)) {
        res.status(500).json({ error: (err as Error).message });
        return;
      }
      switch (err.kind) {
        case "bad_request":
          res.status(400).json({ error: err.message });
          return;
        case "usage_limit":
          res.status(429).json({ error: err.message, code: "usage_limit" });
          return;
        case "not_installed":
          res.status(500).json({ error: err.message });
          return;
        default:
          res.status(502).json({ error: err.message });
      }
    }
  }
);
