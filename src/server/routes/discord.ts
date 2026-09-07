import { Router } from "express";
import express from "express";
import { setEnvVar, readEnvVar } from "../util/env-file";
import { botState, reloginDiscord } from "../discord/client";
import { isPlaceholder, maskKey } from "../config/env";
import { normaliseToken, verifyToken } from "../discord/token";

export const discordRouter = Router();

// Recommended bot permissions, ORed together:
//   Send Messages         (1 << 11)  = 2048
//   Embed Links           (1 << 14)  = 16384
//   Attach Files          (1 << 15)  = 32768
//   Read Message History  (1 << 16)  = 65536
//   Add Reactions         (1 << 6)   = 64
// Total: 116800. Adjust manually if you need slash commands later.
const RECOMMENDED_PERMISSIONS = 116800;

function buildInviteUrl(appId: string): string {
  return `https://discord.com/oauth2/authorize?client_id=${encodeURIComponent(appId)}&permissions=${RECOMMENDED_PERMISSIONS}&scope=bot`;
}

interface DiscordSnapshot {
  appId: string | null;
  appIdConfigured: boolean;
  tokenConfigured: boolean;
  maskedToken: string | null;
  status: string;
  inviteUrl: string | null;
}

function snapshot(): DiscordSnapshot {
  const appId = readEnvVar("DISCORD_APP_ID");
  const token = readEnvVar("DISCORD_TOKEN");
  return {
    appId: appId || null,
    appIdConfigured: !!appId,
    tokenConfigured: !isPlaceholder(token),
    maskedToken: token ? maskKey(token) : null,
    status: botState.status,
    inviteUrl: appId ? buildInviteUrl(appId) : null,
  };
}

discordRouter.get("/api/discord", (_req, res) => {
  res.json(snapshot());
});

// Check a token without saving it.
//
// The dashboard calls this as the user pastes, so "is this the right string?"
// is answered while they still have the Developer Portal open — rather than
// minutes later, in a log, as a gateway login failure detached from the
// action that caused it.
discordRouter.post("/api/discord/verify", express.json({ limit: "10kb" }), async (req, res) => {
  const { token } = req.body ?? {};
  if (typeof token !== "string" || !token.trim()) {
    res.status(400).json({ error: "token is required" });
    return;
  }
  const verdict = await verifyToken(token);
  res.json({
    ...verdict,
    inviteUrl: verdict.ok && verdict.appId ? buildInviteUrl(verdict.appId) : null,
  });
});

// Partial update — accept any subset of { appId, token }.
//
// The App ID no longer needs to be supplied: a bot token's first segment IS
// the application id, so pasting the token gives us both. The field is still
// accepted for an explicit override and for back-compat with an older
// dashboard, but the derived value wins when a token is present — a
// hand-typed App ID that disagrees with the token is a mistake, not an
// instruction.
discordRouter.post("/api/discord", express.json({ limit: "10kb" }), async (req, res) => {
  const { appId, token } = req.body ?? {};
  let reloginNeeded = false;

  try {
    if (appId !== undefined && token === undefined) {
      if (typeof appId !== "string") {
        res.status(400).json({ error: "appId must be a string" });
        return;
      }
      // Discord snowflakes are 17-20 digit numeric strings. Loose check.
      if (appId && !/^\d{17,20}$/.test(appId.trim())) {
        res.status(400).json({ error: "appId doesn't look like a Discord application ID (17-20 digits)" });
        return;
      }
      setEnvVar("DISCORD_APP_ID", appId.trim());
    }

    if (token !== undefined) {
      if (typeof token !== "string" || !token.trim()) {
        res.status(400).json({ error: "token must be a non-empty string" });
        return;
      }
      // Verify before writing. Storing a token that does not work leaves the
      // dashboard claiming to be configured while the bot never connects.
      const verdict = await verifyToken(token);
      if (!verdict.ok) {
        res.status(400).json({ error: verdict.error ?? "That token did not work." });
        return;
      }
      setEnvVar("DISCORD_TOKEN", normaliseToken(token));
      if (verdict.appId) setEnvVar("DISCORD_APP_ID", verdict.appId);
      reloginNeeded = true;
    }

    if (reloginNeeded) await reloginDiscord();
    res.json({ ok: true, ...snapshot() });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Kept for back-compat with the modal's older token-only flow. Same
// verify-then-store discipline as the main route — a second door into the
// same store must not have weaker locks.
discordRouter.post("/api/discord/token", express.json({ limit: "10kb" }), async (req, res) => {
  const { token } = req.body ?? {};
  if (typeof token !== "string" || !token.trim()) {
    res.status(400).json({ error: "token is required (non-empty string)" });
    return;
  }
  try {
    const verdict = await verifyToken(token);
    if (!verdict.ok) {
      res.status(400).json({ error: verdict.error ?? "That token did not work." });
      return;
    }
    setEnvVar("DISCORD_TOKEN", normaliseToken(token));
    if (verdict.appId) setEnvVar("DISCORD_APP_ID", verdict.appId);
    await reloginDiscord();
    res.json({ ok: true, ...snapshot() });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

discordRouter.delete("/api/discord", async (_req, res) => {
  try {
    setEnvVar("DISCORD_APP_ID", "");
    setEnvVar("DISCORD_TOKEN", "");
    await reloginDiscord();
    res.json({ ok: true, ...snapshot() });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});
