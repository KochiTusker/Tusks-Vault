#!/usr/bin/env node
// stdio ↔ HTTP shim for MCP clients that cannot speak Streamable HTTP.
//
// Vault's MCP endpoint is HTTP, which covers the Foundry module and any
// HTTP-capable client. Some clients — Claude Desktop among them — still expect
// to spawn a subprocess and talk newline-delimited JSON-RPC over stdin/stdout.
// This forwards those messages to the HTTP endpoint rather than reimplementing
// the tools: one source of truth, two ways in.
//
// Usage (in a client's MCP server config):
//
//   command: node
//   args:    ["<path to repo>/scripts/mcp-stdio.mjs"]
//   env:     { TUSKS_VAULT_URL: "http://127.0.0.1:3000",
//              TUSKS_VAULT_TOKEN: "<token from pairing>" }
//
// To get a token, pair as a plain MCP client:
//
//   curl -sX POST http://127.0.0.1:3000/api/mcp/pair/request \
//     -H 'Content-Type: application/json' \
//     -d '{"surface":"mcp","clientName":"Claude Desktop"}'
//
// then approve it in the dashboard under Surfaces and read the token from
// /api/mcp/pair/status?requestId=<id>.

import process from "node:process";

const BASE = (process.env.TUSKS_VAULT_URL || "http://127.0.0.1:3000").replace(/\/+$/, "");
const TOKEN = process.env.TUSKS_VAULT_TOKEN || "";
const PROTOCOL_VERSION = "2025-06-18";

// stdout carries the protocol and NOTHING else — a stray console.log there
// corrupts the stream and the client reports an unparseable message rather than
// the actual problem. Diagnostics go to stderr, which clients surface as logs.
const logError = (...args) => process.stderr.write(`[tusks-vault] ${args.join(" ")}\n`);

if (!TOKEN) {
  logError("TUSKS_VAULT_TOKEN is not set. Pair with Tusk's Vault first — see the header of this file.");
  process.exit(1);
}

let sessionId = null;

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function errorFor(id, code, message) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

async function forward(message) {
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${TOKEN}`,
    "MCP-Protocol-Version": PROTOCOL_VERSION,
  };
  if (sessionId) headers["Mcp-Session-Id"] = sessionId;

  const res = await fetch(`${BASE}/mcp`, {
    method: "POST",
    headers,
    body: JSON.stringify(message),
  });

  // The session id arrives on the initialize response and is required on
  // everything after it.
  const issued = res.headers.get("Mcp-Session-Id");
  if (issued) sessionId = issued;

  // 202 is the answer to a notification: nothing to write back, and writing an
  // empty result would be a response to a message that had no id.
  if (res.status === 202) return null;

  const text = await res.text();
  if (!res.ok) {
    let detail = text;
    try {
      detail = JSON.parse(text).error ?? text;
    } catch {
      /* keep the raw body */
    }
    // A transport-level refusal has to be reported in-band; the client is
    // waiting on an id and will hang otherwise.
    return errorFor(message.id, -32603, `Tusk's Vault refused the request (${res.status}): ${detail}`);
  }

  try {
    return JSON.parse(text);
  } catch {
    return errorFor(message.id, -32700, "Tusk's Vault returned an unparseable response.");
  }
}

let buffer = "";
process.stdin.setEncoding("utf-8");

process.stdin.on("data", chunk => {
  buffer += chunk;

  // Newline-delimited JSON. Everything up to the last newline is complete; the
  // remainder is a partial message and stays in the buffer.
  let index = buffer.indexOf("\n");
  while (index !== -1) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    index = buffer.indexOf("\n");
    if (!line) continue;

    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      send(errorFor(null, -32700, "Parse error."));
      continue;
    }

    // Not awaited: a client may pipeline requests, and serialising them here
    // would make this shim a bottleneck the HTTP endpoint does not have.
    forward(parsed)
      .then(response => {
        if (response) send(response);
      })
      .catch(err => {
        logError("forward failed:", err?.message ?? String(err));
        send(errorFor(parsed.id, -32603, `Could not reach Tusk's Vault at ${BASE}.`));
      });
  }
});

process.stdin.on("end", () => process.exit(0));
