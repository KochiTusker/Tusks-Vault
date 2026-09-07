import { Router } from "express";
import { botState, discordClient } from "../discord/client";
import { isGenerating } from "../util/generation-state";
import { appVersion } from "../util/app-version";

export const statusRouter = Router();

statusRouter.get("/api/status", (_req, res) => {
  res.json({
    version: appVersion(),
    status: botState.status,
    botName: discordClient.user?.username || "Not Logged In",
    guilds: discordClient.guilds.cache.size,
    // True while at least one Discord reply is mid-composition. The
    // dashboard mirrors this onto the answer-reactive chrome.
    generating: isGenerating(),
  });
});
