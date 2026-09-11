import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_PDF_BYTES } from "../util/pdf-text";

const realFetch = globalThis.fetch;

/** A response whose body streams `bytes` in small chunks, so the cap has to
 *  hold mid-transfer rather than after the whole thing has landed. */
function streamed(bytes: Buffer, opts: { declare?: number | null } = {}) {
  const CHUNK = 8 * 1024;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < bytes.byteLength; i += CHUNK) {
        controller.enqueue(new Uint8Array(bytes.subarray(i, i + CHUNK)));
      }
      controller.close();
    },
    cancel() {
      cancelled = true;
    },
  });
  const headers = new Headers();
  const declared = opts.declare === undefined ? bytes.byteLength : opts.declare;
  if (declared !== null) headers.set("content-length", String(declared));
  const res = new Response(body, { status: 200, headers });
  return { res, wasCancelled: () => cancelled };
}

let parseDiscordAttachments: typeof import("./attachments").parseDiscordAttachments;

beforeEach(async () => {
  vi.resetModules();
  ({ parseDiscordAttachments } = await import("./attachments"));
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const textOf = (parts: Awaited<ReturnType<typeof parseDiscordAttachments>>) =>
  parts.map(p => (p.type === "text" ? p.text : `<${p.type}>`)).join("\n");

describe("attachment ingest — ordinary files are unaffected", () => {
  it("reads a small text file exactly as before", async () => {
    const body = Buffer.from("The granary burned in Tenth-month.", "utf8");
    globalThis.fetch = vi.fn(async () => streamed(body).res) as never;

    const parts = await parseDiscordAttachments([
      { url: "https://cdn.example/notes.txt", name: "notes.txt", contentType: "text/plain" },
    ]);
    expect(parts).toHaveLength(1);
    expect(textOf(parts)).toBe("Context from file notes.txt:\nThe granary burned in Tenth-month.");
  });

  it("passes a small PDF through as a document part, bytes intact", async () => {
    const body = Buffer.from("%PDF-1.7 fake", "utf8");
    globalThis.fetch = vi.fn(async () => streamed(body).res) as never;

    const parts = await parseDiscordAttachments([
      { url: "https://cdn.example/map.pdf", name: "map.pdf", contentType: "application/pdf" },
    ]);
    expect(parts[0]).toMatchObject({
      type: "document",
      mime: "application/pdf",
      name: "map.pdf",
      base64: body.toString("base64"),
    });
  });

  it("ignores a type it does not handle, exactly as before", async () => {
    globalThis.fetch = vi.fn(async () => streamed(Buffer.from("x")).res) as never;
    const parts = await parseDiscordAttachments([
      { url: "https://cdn.example/a.bin", name: "a.bin", contentType: "application/octet-stream" },
    ]);
    expect(parts).toHaveLength(0);
  });
});

describe("attachment ingest — resource ceilings", () => {
  it("rejects an oversized file on its declared length, without transferring it", async () => {
    const small = Buffer.from("still readable", "utf8");
    globalThis.fetch = vi.fn(async (url: string) => {
      if (String(url).includes("huge")) {
        // Declares more than the ceiling. The check runs before the read loop,
        // so the bytes are never pulled.
        const headers = new Headers({ "content-length": String(MAX_PDF_BYTES + 1) });
        return new Response(new ReadableStream<Uint8Array>({ start: c => c.close() }), {
          status: 200,
          headers,
        });
      }
      return streamed(small).res;
    }) as never;

    const parts = await parseDiscordAttachments([
      { url: "https://cdn.example/huge.pdf", name: "huge.pdf", contentType: "application/pdf" },
      { url: "https://cdn.example/ok.txt", name: "ok.txt", contentType: "text/plain" },
    ]);
    expect(textOf(parts)).toMatch(/could not be read — larger than the \d+ MB limit/);
    // A refused file must not spend the message's budget — otherwise one
    // oversized upload would silently suppress everything after it.
    expect(textOf(parts)).toContain("still readable");
  });

  it("stops mid-stream when the declared length lied", async () => {
    // content-length is the sender's claim. The running total is the guard.
    const big = Buffer.alloc(MAX_PDF_BYTES + 64 * 1024, 0x41);
    const s = streamed(big, { declare: 10 });
    globalThis.fetch = vi.fn(async () => s.res) as never;

    const parts = await parseDiscordAttachments([
      { url: "https://cdn.example/liar.txt", name: "liar.txt", contentType: "text/plain" },
    ]);
    expect(textOf(parts)).toMatch(/could not be read/);
    expect(s.wasCancelled(), "the download must be hung up, not run to completion").toBe(true);
  });

  it("caps the message as a whole, not just each file", async () => {
    // Each file is individually legal; together they are not. Discord allows
    // ten attachments per message.
    const half = Buffer.alloc(Math.floor(MAX_PDF_BYTES / 2) + 1024, 0x42);
    globalThis.fetch = vi.fn(async () => streamed(half).res) as never;

    const many = Array.from({ length: 6 }, (_, i) => ({
      url: `https://cdn.example/f${i}.txt`,
      name: `f${i}.txt`,
      contentType: "text/plain",
    }));
    const parts = await parseDiscordAttachments(many);
    const refused = parts.filter(p => p.type === "text" && p.text.includes("could not be read"));
    expect(refused.length, "the aggregate budget must refuse the later files").toBeGreaterThan(0);
  });

  it("explains a refusal in the prompt instead of skipping silently", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("network down");
    }) as never;
    const parts = await parseDiscordAttachments([
      { url: "https://cdn.example/x.txt", name: "x.txt", contentType: "text/plain" },
    ]);
    // A silent skip reads to the table as the bot ignoring them.
    expect(textOf(parts)).toContain("x.txt");
    expect(textOf(parts)).toMatch(/could not be read/);
  });
});
