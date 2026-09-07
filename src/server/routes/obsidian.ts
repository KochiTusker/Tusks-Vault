// Obsidian vault routes — inspect a vault, and build/clear its map.
//
// Every route here is loopbackOnly. The vault path is an arbitrary absolute
// filesystem path chosen by the caller, and these routes read whatever it
// names. Under HOST=0.0.0.0 — a documented option for running the dashboard
// on a home server — a LAN visitor otherwise reaches them, and "point the
// vault at C:\Users and read the map" is a file-disclosure primitive. The
// same reasoning as the Claude Code generate route: reading lore over the LAN
// is fine, choosing which of the host's directories to read is not.

import { Router } from "express";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { getSettings, saveSettings } from "../config/settings";
import { loopbackOnly } from "../util/loopback-only";
import { buildVaultMap, deleteVaultMap, readVaultMap, type BuildProgress } from "../knowledge/obsidian/map";
import { readNote } from "../knowledge/obsidian/note";
import { safeVaultPath, walkVaultNotes } from "../knowledge/obsidian/walk";
import { listDirectory } from "../knowledge/obsidian/browse";

export const obsidianRouter = Router();

obsidianRouter.use("/api/obsidian", loopbackOnly());

/** A directory with `.obsidian/` in it is unambiguously a vault. Without it
 *  we still accept the folder — Obsidian only creates that directory once the
 *  app has opened the vault, and a user pointing at a plain folder of notes is
 *  doing something reasonable — but we report which case it was so the UI can
 *  say "this doesn't look like a vault" rather than silently indexing the
 *  wrong directory. */
export interface VaultInspection {
  ok: boolean;
  error?: string;
  path?: string;
  isObsidianVault?: boolean;
  noteCount?: number;
  /** Top-level folder → note count. What the user recognises their vault by. */
  folders?: Array<{ name: string; count: number }>;
  /** Frontmatter keys observed, most common first. */
  frontmatterKeys?: string[];
  notesWithAliases?: number;
}

/** Read-only inspection of a candidate vault. Reads frontmatter fences only,
 *  never note bodies — enough to report structure without loading a corpus
 *  into memory to answer "is this the right folder?". */
export function inspectVault(vaultPath: string): VaultInspection {
  const trimmed = (vaultPath ?? "").trim();
  if (!trimmed) return { ok: false, error: "No path given." };
  if (!path.isAbsolute(trimmed)) {
    return { ok: false, error: "Give the vault's full path, not a relative one." };
  }
  let stat: fs.Stats;
  try {
    stat = fs.statSync(trimmed);
  } catch {
    return { ok: false, error: "Nothing exists at that path." };
  }
  if (!stat.isDirectory()) return { ok: false, error: "That path is a file, not a folder." };

  const isObsidianVault = fs.existsSync(path.join(trimmed, ".obsidian"));
  const notes = walkVaultNotes(trimmed);
  const folderCounts = new Map<string, number>();
  const keyCounts = new Map<string, number>();
  let notesWithAliases = 0;

  for (const note of notes) {
    const top = note.relPath.includes("/") ? note.relPath.slice(0, note.relPath.indexOf("/")) : "(root)";
    folderCounts.set(top, (folderCounts.get(top) ?? 0) + 1);
    const parsed = readNote(note.absPath, note.relPath);
    if (!parsed) continue;
    for (const key of parsed.keys) keyCounts.set(key, (keyCounts.get(key) ?? 0) + 1);
    if (parsed.aliases.length > 0) notesWithAliases++;
  }

  return {
    ok: true,
    path: trimmed,
    isObsidianVault,
    noteCount: notes.length,
    folders: [...folderCounts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    frontmatterKeys: [...keyCounts.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k),
    notesWithAliases,
  };
}

obsidianRouter.post("/api/obsidian/inspect", express.json({ limit: "10kb" }), (req, res) => {
  const { path: vaultPath } = (req.body ?? {}) as { path?: string };
  res.json(inspectVault(String(vaultPath ?? "")));
});

// One level of directory names, for the folder picker.
//
// GET with no `path` returns the roots (drive letters / `/`, plus home).
// Directories only — never file names, never contents. See browse.ts for what
// this does and does not disclose; it is loopbackOnly like everything else on
// this router, which is what makes enumerating the host's folders acceptable.
obsidianRouter.get("/api/obsidian/browse", (req, res) => {
  const target = typeof req.query.path === "string" ? req.query.path : "";
  res.json(listDirectory(target));
});

obsidianRouter.get("/api/obsidian/status", (_req, res) => {
  const settings = getSettings();
  const vaultPath = (settings.obsidianVaultPath ?? "").trim();
  const map = vaultPath ? readVaultMap(vaultPath) : null;
  const modelled = map?.notes.filter(n => n.summarySource === "model").length ?? 0;
  res.json({
    loreSource: settings.loreSource,
    useVaultMap: settings.useVaultMap,
    vaultPath: vaultPath || null,
    vaultExists: vaultPath ? fs.existsSync(vaultPath) : false,
    map: map
      ? {
          builtAt: map.builtAt,
          model: map.model,
          noteCount: map.notes.length,
          modelSummarised: modelled,
          mechanicalSummarised: map.notes.length - modelled,
          /** Notes whose file has changed since the map was built. */
          staleCount: countStale(vaultPath, map.notes.map(n => n.relPath)),
        }
      : null,
  });
});

/** How many mapped notes no longer exist, plus how many vault notes aren't in
 *  the map. Cheap (a directory walk, no file reads) and it is the number that
 *  tells a user whether a rebuild is worth running. */
function countStale(vaultPath: string, mapped: string[]): number {
  if (!vaultPath || !fs.existsSync(vaultPath)) return 0;
  const onDisk = new Set(walkVaultNotes(vaultPath).map(n => n.relPath));
  const inMap = new Set(mapped);
  let stale = 0;
  for (const p of onDisk) if (!inMap.has(p)) stale++;
  for (const p of inMap) if (!onDisk.has(p)) stale++;
  return stale;
}

// Streamed because a first build on a few hundred notes is minutes of model
// calls, and a request that just hangs for two minutes is indistinguishable
// from one that has died.
obsidianRouter.post("/api/obsidian/map/build", express.json({ limit: "10kb" }), async (req, res) => {
  const settings = getSettings();
  const vaultPath = ((req.body?.path as string | undefined) ?? settings.obsidianVaultPath ?? "").trim();
  if (!vaultPath) {
    res.status(400).json({ error: "No vault path configured." });
    return;
  }
  const force = req.body?.force === true;
  const mechanicalOnly = req.body?.mechanicalOnly === true;

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    // Without this an intermediary can buffer the whole stream and deliver it
    // at the end, which is exactly the behaviour the stream exists to avoid.
    "X-Accel-Buffering": "no",
  });
  const send = (event: string, data: unknown) => {
    if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  let lastEmit = 0;
  const onProgress = (p: BuildProgress) => {
    // Throttle: the embedding phase ticks once per note, and a note takes a
    // few milliseconds. Streaming every tick floods the client with events it
    // cannot render fast enough.
    const now = Date.now();
    if (p.phase !== "done" && now - lastEmit < 250) return;
    lastEmit = now;
    send("progress", p);
  };

  try {
    const result = await buildVaultMap(vaultPath, { force, mechanicalOnly, onProgress });
    send("done", {
      notesTotal: result.notesTotal,
      notesSummarised: result.notesSummarised,
      batchesFailed: result.batchesFailed,
      mechanicalOnly: result.mechanicalOnly,
      model: result.map.model,
      builtAt: result.map.builtAt,
    });
  } catch (err) {
    send("error", { error: (err as Error).message });
  } finally {
    res.end();
  }
});

obsidianRouter.delete("/api/obsidian/map", (_req, res) => {
  const settings = getSettings();
  const vaultPath = (settings.obsidianVaultPath ?? "").trim();
  if (vaultPath) deleteVaultMap(vaultPath);
  res.json({ ok: true });
});

/** One note's parsed content, for the dashboard's preview. Path-checked
 *  against the configured vault — the caller names a note, and a note name is
 *  request input like any other. */
obsidianRouter.get("/api/obsidian/note", (req, res) => {
  const settings = getSettings();
  const vaultPath = (settings.obsidianVaultPath ?? "").trim();
  const relPath = String(req.query.path ?? "");
  const abs = vaultPath ? safeVaultPath(vaultPath, relPath) : null;
  if (!abs) {
    res.status(400).json({ error: "Unknown note." });
    return;
  }
  const parsed = readNote(abs, relPath);
  if (!parsed) {
    res.status(404).json({ error: "Could not read that note." });
    return;
  }
  res.json({
    relPath,
    title: parsed.title,
    type: parsed.type,
    aliases: parsed.aliases,
    relations: parsed.relations,
    body: parsed.body.slice(0, 20_000),
  });
});

/** Switch lore source / vault path / map mode in one call, so the dashboard
 *  never leaves the pair half-applied (source=obsidian with no path). */
obsidianRouter.post("/api/obsidian/source", express.json({ limit: "10kb" }), (req, res) => {
  const { source, path: vaultPath, useVaultMap } = (req.body ?? {}) as {
    source?: string;
    path?: string;
    useVaultMap?: boolean;
  };
  const settings = getSettings();

  if (source === "obsidian") {
    const inspection = inspectVault(String(vaultPath ?? settings.obsidianVaultPath ?? ""));
    if (!inspection.ok) {
      res.status(400).json({ error: inspection.error });
      return;
    }
    settings.loreSource = "obsidian";
    settings.obsidianVaultPath = inspection.path;
  } else if (source === "folder") {
    settings.loreSource = "folder";
  } else if (source !== undefined) {
    res.status(400).json({ error: "source must be 'folder' or 'obsidian'" });
    return;
  }
  if (useVaultMap !== undefined) settings.useVaultMap = !!useVaultMap;

  saveSettings(settings);
  res.json({
    loreSource: settings.loreSource,
    vaultPath: settings.obsidianVaultPath ?? null,
    useVaultMap: settings.useVaultMap,
  });
});
