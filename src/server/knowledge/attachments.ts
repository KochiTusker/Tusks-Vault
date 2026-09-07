import { createRequire } from "module";
import type { ContentPart } from "../llm/types";

const require = createRequire(import.meta.url);
const mammoth = require("mammoth");

interface DiscordAttachmentLike {
  url: string;
  name?: string | null;
  contentType?: string | null;
}

export async function parseDiscordAttachments(
  attachments: Iterable<DiscordAttachmentLike>
): Promise<ContentPart[]> {
  const parts: ContentPart[] = [];

  for (const attachment of attachments) {
    const contentType = attachment.contentType ?? "";
    const name = attachment.name ?? "attachment";

    try {
      if (contentType.startsWith("image/")) {
        const response = await fetch(attachment.url);
        const buffer = await response.arrayBuffer();
        parts.push({
          type: "image",
          mime: contentType,
          base64: Buffer.from(buffer).toString("base64"),
        });
      } else if (contentType === "application/pdf") {
        // Pass raw PDF bytes through to the adapter. Gemini accepts native
        // PDFs; the others pre-extract text.
        const response = await fetch(attachment.url);
        const buffer = await response.arrayBuffer();
        parts.push({
          type: "document",
          mime: "application/pdf",
          base64: Buffer.from(buffer).toString("base64"),
          name,
        });
      } else if (
        contentType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      ) {
        const response = await fetch(attachment.url);
        const buffer = await response.arrayBuffer();
        const result = await mammoth.extractRawText({ buffer: Buffer.from(buffer) });
        parts.push({ type: "text", text: `Context from DOCX ${name}:\n${result.value.substring(0, 30000)}` });
      } else if (contentType.startsWith("text/")) {
        const response = await fetch(attachment.url);
        const text = await response.text();
        parts.push({ type: "text", text: `Context from file ${name}:\n${text.substring(0, 30000)}` });
      }
    } catch (err) {
      console.error(`Error parsing attachment ${name}:`, err);
      parts.push({ type: "text", text: `(Error parsing attachment ${name})` });
    }
  }

  return parts;
}
