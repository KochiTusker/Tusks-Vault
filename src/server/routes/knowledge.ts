import { Router } from "express";
import { deleteKnowledgeFile, knowledgeUpload, listKnowledgeFiles } from "../knowledge/loader";

export const knowledgeRouter = Router();

knowledgeRouter.get("/api/knowledge", (_req, res) => {
  try {
    res.json(listKnowledgeFiles());
  } catch (err) {
    console.error("Failed to list knowledge base:", err);
    res.status(500).json({ error: "Failed to list knowledge base" });
  }
});

knowledgeRouter.post("/api/knowledge", knowledgeUpload.array("files"), (req, res) => {
  const files = (req.files as Express.Multer.File[]) ?? [];
  if (files.length === 0) {
    res.status(400).json({ error: "No files uploaded" });
    return;
  }
  res.json({ message: "Files uploaded successfully", count: files.length });
});

knowledgeRouter.delete("/api/knowledge/:filename", (req, res) => {
  if (deleteKnowledgeFile(req.params.filename)) {
    res.json({ message: "File deleted successfully" });
  } else {
    res.status(404).json({ error: "File not found" });
  }
});
