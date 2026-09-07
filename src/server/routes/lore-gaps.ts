import { Router } from "express";
import express from "express";
import { deleteLoreGap, getLoreGaps, saveLoreGaps, updateLoreGap } from "../lore-gaps/store";
import { upsertClarification } from "../clarifications/store";

export const loreGapsRouter = Router();

loreGapsRouter.get("/api/lore-gaps", (_req, res) => {
  res.json(getLoreGaps());
});

loreGapsRouter.post("/api/lore-gaps/resolve", express.json({ limit: "200kb" }), async (req, res) => {
  const { id, answer } = req.body ?? {};
  if (!id || !answer) {
    res.status(400).json({ error: "id and answer are required" });
    return;
  }

  const gaps = getLoreGaps();
  const gapIndex = gaps.findIndex(g => g.id === id);
  if (gapIndex === -1) {
    res.status(404).json({ error: "Lore gap not found" });
    return;
  }

  await upsertClarification({ question: gaps[gapIndex].question, answer });
  gaps.splice(gapIndex, 1);
  saveLoreGaps(gaps);
  res.json({ message: "Lore gap resolved and added to clarifications" });
});

loreGapsRouter.delete("/api/lore-gaps/:id", (req, res) => {
  deleteLoreGap(req.params.id);
  res.json({ message: "Lore gap deleted" });
});

loreGapsRouter.put("/api/lore-gaps/:id", express.json({ limit: "200kb" }), (req, res) => {
  const { question } = req.body ?? {};
  if (typeof question !== "string" || !question.trim()) {
    res.status(400).json({ error: "question is required" });
    return;
  }
  const updated = updateLoreGap(req.params.id, question.trim());
  if (!updated) {
    res.status(404).json({ error: "Lore gap not found" });
    return;
  }
  res.json(updated);
});
