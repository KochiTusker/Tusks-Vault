import { Router } from "express";
import { loopbackOnly } from "../util/loopback-only";
import { logs, clearAllLogs } from "../util/log-capture";

export const logsRouter = Router();

// The captured log carries the key store's absolute path (keys/store.ts logs
// it at boot), so reading it discloses the OS account name the same way
// /api/diagnostics does — and scrub-secrets.ts redacts credential shapes, not
// paths. DELETE lets a caller wipe the operator's own log, which is
// administration by any reading. Both are loopback-only now.
logsRouter.use("/api/logs", loopbackOnly());

logsRouter.get("/api/logs", (_req, res) => {
  res.json(logs);
});

logsRouter.delete("/api/logs", (_req, res) => {
  clearAllLogs();
  res.json({ message: "Logs cleared" });
});
