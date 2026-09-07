import { Router } from "express";
import { loopbackOnly } from "../util/loopback-only";
import express from "express";
import {
  clearDevCredential,
  devCredentialStatus,
  setDevCredential,
} from "../util/dev-credential";

export const devCredentialRouter = Router();

// Updater administration, living outside the /api/updates prefix that already
// carries this gate. It accepts a GitHub PAT and validates it against the dev
// repo — a token-validation oracle — and DELETE drops the maintainer's stored
// credential. Same policy as the updater it belongs to.
devCredentialRouter.use("/api/updater/dev-credential", loopbackOnly());

// GET /api/updater/dev-credential — does the server hold a token right now?
// Used by the dashboard to decide whether to show the "Authenticate" input
// or the "✓ Token set this session" state. Never returns the token itself.
devCredentialRouter.get("/api/updater/dev-credential", (_req, res) => {
  res.json(devCredentialStatus());
});

// POST /api/updater/dev-credential — paste a GitHub PAT.
//
// Body: { token: string }
//
// Validation flow:
//   1. Shape check: must look like a GitHub PAT (ghp_/gho_/ghu_/ghs_/ghr_/
//      github_pat_ prefix + alphanumerics).
//   2. Access check: server calls GitHub's /repos/<owner>/<repo> endpoint
//      with the token. Only stores the token if GitHub returns 200.
//
// On success, the token lives in process memory for the rest of this
// process's lifetime. It's never written to disk, never logged (scrubbed
// by log-capture.ts patterns), and is cleared on next server restart.
devCredentialRouter.post(
  "/api/updater/dev-credential",
  express.json({ limit: "10kb" }),
  async (req, res) => {
    const { token } = (req.body ?? {}) as { token?: unknown };
    if (typeof token !== "string") {
      res.status(400).json({ ok: false, reason: "Body must include a `token` string." });
      return;
    }
    try {
      const result = await setDevCredential(token);
      if (result.ok) {
        res.json({
          ok: true,
          reason: result.reason,
          ownerRepo: result.ownerRepo,
          ...devCredentialStatus(),
        });
      } else {
        res.status(401).json({ ok: false, reason: result.reason });
      }
    } catch (err) {
      console.error("[dev-credential] verify failed:", err);
      res.status(500).json({ ok: false, reason: (err as Error).message });
    }
  },
);

// DELETE /api/updater/dev-credential — wipe the in-memory token.
// Mirrors what happens automatically on server restart. Lets the
// maintainer "log out of dev mode" without restarting.
devCredentialRouter.delete("/api/updater/dev-credential", (_req, res) => {
  clearDevCredential();
  res.json({ ok: true, ...devCredentialStatus() });
});
