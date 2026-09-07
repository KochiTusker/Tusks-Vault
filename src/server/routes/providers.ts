import { Router } from "express";
import { getSettings } from "../config/settings";
import { listProviderStatuses } from "../llm/registry";
import { listKeys } from "../keys/store";

export const providersRouter = Router();

providersRouter.get("/api/providers", (_req, res) => {
  const keys = listKeys();
  const statuses = listProviderStatuses(getSettings()).map(s => ({
    ...s,
    storedKeyCount: keys.filter(k => k.provider === s.id).length,
  }));
  res.json(statuses);
});
