import { Router } from "express";
import express from "express";
import {
  deleteClarification,
  getClarifications,
  hasEmbedding,
  upsertClarification,
} from "../clarifications/store";
import { getRelevantClarifications } from "../clarifications/retrieve";
import { getSettings } from "../config/settings";

export const clarificationsRouter = Router();

clarificationsRouter.get("/api/clarifications", (_req, res) => {
  const list = getClarifications().map(c => ({ ...c, embedded: hasEmbedding(c.id) }));
  res.json(list);
});

clarificationsRouter.post("/api/clarifications", express.json({ limit: "200kb" }), async (req, res) => {
  const { question, answer, id } = req.body ?? {};
  if (!question || !answer) {
    res.status(400).json({ error: "question and answer are required" });
    return;
  }
  const saved = await upsertClarification({ id, question, answer });
  res.json({ message: "Clarification saved successfully", id: saved.id, embedded: hasEmbedding(saved.id) });
});

clarificationsRouter.delete("/api/clarifications/:id", (req, res) => {
  deleteClarification(req.params.id);
  res.json({ message: "Clarification deleted" });
});

// Debug + tuning aid: shows what would be retrieved for a given query so the
// DM can sanity-check their threshold/topK choice without running a full Discord
// query through an LLM.
clarificationsRouter.get("/api/clarifications/retrieve", async (req, res) => {
  const query = typeof req.query.q === "string" ? req.query.q : "";
  if (!query.trim()) {
    res.status(400).json({ error: "?q=<text> is required" });
    return;
  }
  const settings = getSettings();
  const topK = req.query.topK ? Number(req.query.topK) : settings.clarificationTopK;
  const threshold = req.query.threshold ? Number(req.query.threshold) : settings.clarificationThreshold;
  try {
    const matches = await getRelevantClarifications(query, { topK, threshold });
    res.json({
      query,
      topK,
      threshold,
      matches: matches.map(m => ({
        id: m.clarification.id,
        question: m.clarification.question,
        answer: m.clarification.answer,
        score: Number(m.score.toFixed(4)),
      })),
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});
