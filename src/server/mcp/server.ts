// Vault's MCP endpoint — Streamable HTTP, mounted as an ordinary Express route.
//
// It runs inside Vault rather than as a broker process beside it. Vault is
// already an HTTP server on a known port with a host/origin guard, a settings
// store and the answering logic in-process; a separate broker would be a second
// thing to install, start, supervise and version-match whose entire job is to
// forward a JSON-RPC call to a server that was already listening.
//
// Streamable HTTP is POST and GET on one path, so there is no `upgrade`
// handling and no second WebSocket contending with the one Vite's HMR already
// shares with this server.
//
// Deliberately NOT streamed. `ask()` resolves once, with the whole answer, so an
// SSE stream would emit nothing until the final token and then close — strictly
// worse than a POST that takes the same time, because it adds a connection to
// manage in exchange for no earlier information. GET therefore answers 405: we
// have no server-initiated messages to deliver, and saying so is better than
// holding a stream open that will never carry anything.

import crypto from "crypto";
import express, { Router, type Request, type Response } from "express";
import { getSettings } from "../config/settings";
import { isSurfaceEnabled } from "../chat/surfaces";
import {
  authenticateToken,
  bearerToken,
  isOriginAllowed,
  normaliseOrigin,
  touchClient,
  type PairedClient,
} from "./auth";
import { findTool, toolListing, type ToolResult } from "./tools";
import { chatSafeError } from "../llm/registry";
import { appVersion } from "../util/app-version";

/** Newest first. `initialize` echoes the client's version when we know it, and
 *  otherwise answers with LATEST so the client can decide whether to proceed. */
export const LATEST_PROTOCOL_VERSION = "2025-06-18";
export const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26"];

/** How long a session survives without traffic. Long enough to span a session
 *  of play with quiet stretches; short enough that abandoned sessions do not
 *  accumulate for the life of the process. */
const SESSION_IDLE_MS = 12 * 60 * 60 * 1000;

const JSONRPC_PARSE_ERROR = -32700;
const JSONRPC_INVALID_REQUEST = -32600;
const JSONRPC_METHOD_NOT_FOUND = -32601;
const JSONRPC_INVALID_PARAMS = -32602;
const JSONRPC_INTERNAL_ERROR = -32603;

interface Session {
  id: string;
  /** The client whose token opened this session. Re-checked on every request so
   *  a revoked token cannot keep riding a session it opened while it was
   *  valid — a revocation that leaves the holder connected is not a
   *  revocation. */
  clientId: string;
  lastSeen: number;
}

const sessions = new Map<string, Session>();

function sweepSessions(): void {
  const cutoff = Date.now() - SESSION_IDLE_MS;
  for (const [id, s] of sessions) {
    if (s.lastSeen < cutoff) sessions.delete(id);
  }
}

/** Drop every session belonging to a client. Called on revoke, so revocation
 *  takes effect on the next request rather than at the next restart. */
export function dropSessionsForClient(clientId: string): void {
  for (const [id, s] of sessions) {
    if (s.clientId === clientId) sessions.delete(id);
  }
}

export function _resetSessionsForTests(): void {
  sessions.clear();
}

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method?: unknown;
  params?: unknown;
}

function rpcError(id: string | number | null, code: number, message: string) {
  return { jsonrpc: "2.0" as const, id, error: { code, message } };
}

function rpcResult(id: string | number | null, result: unknown) {
  return { jsonrpc: "2.0" as const, id, result };
}

/**
 * CORS for a browser-based MCP client.
 *
 * The allow-list is the set of origins that completed pairing — never a
 * wildcard, and never a value read out of the request. An unpaired origin gets
 * no CORS headers at all, so the browser refuses to hand the response to the
 * page even in the case where the request itself somehow got through.
 */
function applyCors(req: Request, res: Response, origin: string): void {
  // Vary regardless of outcome: the response for one origin must never be
  // served from cache to another.
  res.setHeader("Vary", "Origin");
  if (!origin || !isOriginAllowed(origin)) return;
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, DELETE, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, Mcp-Session-Id, MCP-Protocol-Version"
  );
  // The module reads the session id off the initialize response, which it
  // cannot do cross-origin unless the header is explicitly exposed.
  res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");
  res.setHeader("Access-Control-Max-Age", "600");
}

interface AuthOutcome {
  client?: PairedClient;
  /** Set when the request must be refused. */
  status?: number;
  error?: string;
}

/**
 * The three gates, in the order that leaks least.
 *
 * Origin is checked before the token so a drive-by page is turned away without
 * its guess ever being compared against a stored credential, and the surface
 * gate runs last so "switched off" is only ever revealed to a caller that had
 * a valid token in the first place.
 */
function authorise(req: Request, origin: string): AuthOutcome {
  if (origin && !isOriginAllowed(origin)) {
    return { status: 403, error: "Origin is not paired with this Vault." };
  }

  const client = authenticateToken(bearerToken(req.headers.authorization as string | undefined));
  if (!client) {
    // One message for absent and for wrong. Distinguishing them tells an
    // attacker which half of the problem to work on.
    return { status: 401, error: "Missing or invalid bridge token." };
  }

  // A token whose origin was pinned at pairing may only be used from it. Without
  // this, a token that leaked out of one browser would work from any page that
  // had also paired.
  if (client.origin && client.origin !== origin) {
    return { status: 403, error: "This token is bound to a different origin." };
  }

  if (!isSurfaceEnabled(getSettings(), client.surface)) {
    return { status: 403, error: `The ${client.surface} surface is switched off in Tusk's Vault.` };
  }

  return { client };
}

/** Reject a protocol version we do not implement, but only when the client
 *  actually stated one — the spec has servers assume an older default when the
 *  header is absent, and refusing on absence would break compliant clients. */
function protocolVersionRejected(req: Request): string | null {
  const raw = (req.headers["mcp-protocol-version"] as string | undefined)?.trim();
  if (!raw) return null;
  return SUPPORTED_PROTOCOL_VERSIONS.includes(raw) ? null : raw;
}

async function dispatch(
  rpc: JsonRpcRequest,
  client: PairedClient,
  session: Session | null,
  res: Response
): Promise<unknown | null> {
  const id = (rpc.id ?? null) as string | number | null;
  const method = typeof rpc.method === "string" ? rpc.method : "";
  const params = (rpc.params ?? {}) as Record<string, unknown>;

  switch (method) {
    case "initialize": {
      const asked = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
      const version = SUPPORTED_PROTOCOL_VERSIONS.includes(asked) ? asked : LATEST_PROTOCOL_VERSION;

      sweepSessions();
      const created: Session = {
        id: crypto.randomUUID(),
        clientId: client.id,
        lastSeen: Date.now(),
      };
      sessions.set(created.id, created);
      res.setHeader("Mcp-Session-Id", created.id);

      return rpcResult(id, {
        protocolVersion: version,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "tusks-vault", version: serverVersion() },
        instructions:
          "Tusk's Vault answers questions about one campaign's lore, grounded in the GM's own " +
          "documents. Prefer search_lore or list_sources when you intend to read the sources " +
          "yourself; ask_lore spends model tokens.",
      });
    }

    // Notifications carry no id and get no response body. `initialized` is the
    // client confirming the handshake; anything else unknown is ignored rather
    // than erroring, per JSON-RPC.
    case "notifications/initialized":
      return null;

    case "ping":
      return rpcResult(id, {});

    case "tools/list":
      if (!session) return rpcError(id, JSONRPC_INVALID_REQUEST, "Session not initialized.");
      return rpcResult(id, { tools: toolListing() });

    case "tools/call": {
      if (!session) return rpcError(id, JSONRPC_INVALID_REQUEST, "Session not initialized.");
      const name = typeof params.name === "string" ? params.name : "";
      const tool = findTool(name);
      if (!tool) return rpcError(id, JSONRPC_METHOD_NOT_FOUND, `Unknown tool: ${name || "(none)"}`);

      const args = (params.arguments ?? {}) as Record<string, unknown>;
      if (typeof args !== "object" || Array.isArray(args)) {
        return rpcError(id, JSONRPC_INVALID_PARAMS, "arguments must be an object.");
      }

      try {
        const result: ToolResult = await tool.handler(args, { client });
        return rpcResult(id, result);
      } catch (err) {
        // A tool that throws is a FAILED CALL, not a broken protocol: report it
        // in-band as isError so the caller — a model, or the Foundry module —
        // can show it and carry on. A JSON-RPC error here would look like the
        // server is broken and take the session down with it.
        const message = (err as Error)?.message ?? String(err);
        // Full detail to Vault's console; a generic line to the caller. The
        // Foundry module posts this text into the chat log, which every
        // connected player reads — so provider names, model ids and local
        // paths must not reach it. The GM has the real message here.
        console.error(`[mcp] tool ${name} failed:`, message);
        return rpcResult(id, {
          content: [{ type: "text", text: chatSafeError(err) }],
          isError: true,
        });
      }
    }

    default:
      if (rpc.id === undefined) return null; // unknown notification — ignore
      return rpcError(id, JSONRPC_METHOD_NOT_FOUND, `Unknown method: ${method || "(none)"}`);
  }
}

// appVersion(), not process.env.npm_package_version: that variable is only
// populated when the process was started through an npm script, so a direct
// `tsx server.ts` launch reported the hardcoded fallback. This value is
// returned on a PRE-AUTH endpoint (JSON-RPC `initialize`), and /api/mcp/hello
// already reports the real version through the shared helper — so the two
// halves of one surface disagreed, one of them saying 0.1.0 forever.
function serverVersion(): string {
  return appVersion();
}

export const mcpRouter = Router();

mcpRouter.options("/mcp", (req, res) => {
  applyCors(req, res, normaliseOrigin(req.headers.origin as string | undefined));
  res.status(204).end();
});

// No server-initiated messages exist, so there is nothing for a stream to
// deliver. 405 with Allow is the spec's answer for exactly this case.
mcpRouter.get("/mcp", (req, res) => {
  applyCors(req, res, normaliseOrigin(req.headers.origin as string | undefined));
  res.setHeader("Allow", "POST, DELETE, OPTIONS");
  res.status(405).json({ error: "This MCP endpoint does not open server-initiated streams." });
});

mcpRouter.delete("/mcp", (req, res) => {
  const origin = normaliseOrigin(req.headers.origin as string | undefined);
  applyCors(req, res, origin);
  const auth = authorise(req, origin);
  if (!auth.client) {
    res.status(auth.status!).json({ error: auth.error });
    return;
  }
  const sessionId = (req.headers["mcp-session-id"] as string | undefined)?.trim();
  if (sessionId) sessions.delete(sessionId);
  res.status(204).end();
});

mcpRouter.post(
  "/mcp",
  // 256 KB: a question plus a little context, never a document. The corpus
  // lives on this side of the wire — nothing legitimate posts bulk here.
  express.json({ limit: "256kb" }),
  async (req: Request, res: Response) => {
    const origin = normaliseOrigin(req.headers.origin as string | undefined);
    applyCors(req, res, origin);

    const badVersion = protocolVersionRejected(req);
    if (badVersion) {
      res.status(400).json({
        error: `Unsupported MCP protocol version: ${badVersion}. ` +
          `This server speaks ${SUPPORTED_PROTOCOL_VERSIONS.join(", ")}.`,
      });
      return;
    }

    const auth = authorise(req, origin);
    if (!auth.client) {
      res.status(auth.status!).json({ error: auth.error });
      return;
    }
    const client = auth.client;

    const body = req.body as unknown;
    // MCP dropped JSON-RPC batching in 2025-06-18. Refusing an array outright
    // is clearer than half-implementing it.
    if (Array.isArray(body)) {
      res.status(400).json(rpcError(null, JSONRPC_INVALID_REQUEST, "Batched requests are not supported."));
      return;
    }
    if (!body || typeof body !== "object") {
      res.status(400).json(rpcError(null, JSONRPC_PARSE_ERROR, "Body must be a JSON-RPC object."));
      return;
    }

    const rpc = body as JsonRpcRequest;
    if (rpc.jsonrpc !== "2.0") {
      res.status(400).json(rpcError(rpc.id ?? null, JSONRPC_INVALID_REQUEST, "jsonrpc must be \"2.0\"."));
      return;
    }

    const isInitialize = rpc.method === "initialize";
    const sessionId = (req.headers["mcp-session-id"] as string | undefined)?.trim();
    let session: Session | null = null;

    if (!isInitialize) {
      if (!sessionId) {
        res.status(400).json({ error: "Mcp-Session-Id header is required after initialize." });
        return;
      }
      sweepSessions();
      const found = sessions.get(sessionId);
      // Belonging to a DIFFERENT client is reported the same as gone. A session
      // id is a bearer value; confirming one exists but is not yours turns it
      // into an oracle.
      if (!found || found.clientId !== client.id) {
        res.status(404).json({ error: "Unknown or expired session. Re-initialize." });
        return;
      }
      found.lastSeen = Date.now();
      session = found;
    }

    let payload: unknown | null;
    try {
      payload = await dispatch(rpc, client, session, res);
    } catch (err) {
      console.error("[mcp] dispatch failed:", (err as Error)?.message ?? err);
      res.status(500).json(rpcError(rpc.id ?? null, JSONRPC_INTERNAL_ERROR, "Internal error."));
      return;
    }

    touchClient(client.id);

    // A notification produced no payload. 202 with an empty body is the spec's
    // answer, and it is not the same as an empty result.
    if (payload === null) {
      res.status(202).end();
      return;
    }
    res.json(payload);
  }
);
