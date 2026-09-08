# The Foundry contract

Tusk's Vault and the Tusk's Vault Foundry module are two programs in two
repositories that have to agree on a wire protocol. This page is that
agreement.

| | |
|---|---|
| **Server** | Tusk's Vault — this repository. Owns `/mcp` and `/api/mcp/*`. |
| **Client** | The Tusk's Vault module — repository `Tusks-Vault-Foundry`. Owns the chat trigger, the pairing UI and the relay. |

## Why they are separate repositories

Foundry's package registry polls a manifest at a **stable** URL and downloads
the package from a **versioned** one. The stable URL is
`releases/latest/download/module.json`, and `latest` means the newest GitHub
Release in that repository — not the newest release whose tag looks like a
module.

Shipping both from one repository therefore means that publishing a single
GitHub Release for the app makes `latest` resolve to it, `module.json` 404, and
**every installed module silently stop seeing updates, permanently**. Nothing
warns; the registry simply stops finding a manifest. Separate repositories
remove the hazard rather than documenting it.

## The rule

**A change to anything on this page is a change to both repositories.**

Both ends assert this contract in their own suites, so a one-sided change fails
a test rather than a GM's chat command:

- Vault: [src/server/mcp/foundry-contract.test.ts](../../src/server/mcp/foundry-contract.test.ts)
  — asserts Vault *serves* what the module expects.
- Module: `test/vault-contract.test.mjs` — asserts the module *sends* what Vault
  accepts.

The two files are deliberately redundant. Either one alone can be edited to make
a breaking change pass; both failing at once is the signal.

When a change is genuinely breaking, revise the protocol string on both sides.
They are not the same constant: the module declares a single
`PROTOCOL_VERSION` (`module/scripts/tusk.js`, currently `2025-06-18`), while
Vault advertises a *list* — `SUPPORTED_PROTOCOL_VERSIONS` in
[src/server/mcp/server.ts](../../src/server/mcp/server.ts), currently
`["2025-06-18", "2025-03-26"]`. Vault keeping the list means an older module
keeps working across a Vault upgrade; the module refuses to pair when its one
string is absent from that list, and says "update Tusk's Vault" — a clear
failure instead of a confusing partial one.

## The contract

### 1. Discovery

`GET /api/mcp/hello` — unauthenticated, answers cross-origin, no preflight.

```json
{ "app": "tusks-vault", "version": "…", "protocolVersions": ["2025-06-18", "…"], "pairing": "open" }
```

- `app` must be exactly `tusks-vault`. The module scans ports 3000–3019 and
  discards every reply that does not match, so renaming this breaks discovery
  on every install at once.
- `protocolVersions` must contain the module's `PROTOCOL_VERSION`.
- `pairing` is `open` or `busy`.
- It must stay a **simple** request — no custom header may become required, or
  every probe turns into a preflight.

Deliberately says nothing about which surfaces are enabled, how much lore is
loaded, or the campaign. Everything past here needs a token.

### 2. Pairing

`POST /api/mcp/pair/request` — cross-origin, unauthenticated, rate-limited.

Sends `{ surface, clientName, worldTitle, foundryVersion }`; `surface` is
`foundry`. Anything unrecognised pairs as plain `mcp`, so a malformed request
cannot claim the Foundry surface by omission.

Returns `{ requestId, code, expiresAt }`, or 409 `{ error, reason }` where
`reason` is `busy` or `denied`. `code` is six digits and is **displayed, not
secret** — the human compares it with what the dashboard shows.

`GET /api/mcp/pair/status?requestId=…` — returns
`{ status, token? }`. `status` is one of `pending`, `approved`, `denied`,
`expired`, `unknown`. The module treats every value except `pending` as
terminal, so **a new status string would hang the pairing dialog** rather than
report anything. The token appears exactly once, on the first read after
approval.

`POST /api/mcp/pair/approve` is **not** part of this contract. The module never
calls it; the dashboard does. It is deliberately absent from the host/origin
guard's delegated-path list, because a page that could both raise a pairing
prompt and grant it would have paired itself.

### 3. The session

`POST /mcp`, JSON-RPC 2.0, Streamable HTTP. `initialize` returns the session in
an **`Mcp-Session-Id` response header**, which must stay listed in
`Access-Control-Expose-Headers` — cross-origin, a header not named there is
invisible to the page, and the module fails with "Vault did not issue a
session".

The preflight must allow `Content-Type`, `Authorization`, `Mcp-Session-Id` and
`MCP-Protocol-Version`.

A request carrying an unknown or expired session gets **404**. That specific
status is the module's signal to re-handshake once and retry, which is what
makes a Vault restart mid-session invisible to the table. A non-`initialize`
request carrying *no* session header at all is a different fault and gets
**400** — nothing was lost, the caller simply skipped the handshake.

`GET /mcp` answers **405**. The bridge is deliberately not streamed: `ask()`
resolves once with the whole answer, so an SSE channel would be a connection
to manage in exchange for no earlier information.

### 4. Tools

Exactly three, named `ask_lore`, `search_lore`, `list_sources`. The module calls
only `ask_lore`.

```jsonc
// arguments
{ "question": "…", "asker": { "id": "…", "displayName": "…", "isGM": false } }
```

`asker` is taken from Foundry's server-side `author` field, never from anything
in the message payload — a player can forge flags on their own message.

The reply carries `content[].text`, which the module joins and renders, and:

```jsonc
"_meta": { "tusks-vault": { "declined": true, "loreGapRecorded": true, "refusedBy": "allowPlayers" } }
```

`declined` and `loreGapRecorded` become CSS classes on the chat card;
renaming either silently drops the styling rather than failing.

A refusal by the player ceiling is **not** `isError` — the refusal is the
answer, and the module posts it as prose.

### 5. Errors

Every non-2xx body is `{ "error": "<a sentence>" }`. The module prints that
string verbatim to the GM. An object renders as `[object Object]`; an absent
field makes the module fall back to a message that blames the connection
instead of naming the cause.

## Known limits

**Approval is refused for remote origins, not for every non-dashboard origin.**

- **The rule.** The host/origin guard allows loopback origins to write, and
  `localhost` on *any* port counts as loopback — so a page served from another
  local port, including Foundry's own, is not refused by it.
- **The exposure.** Reaching that position requires code already running on the
  machine, such as a hostile Foundry module — at which point the lore files are
  readable anyway.
- **The fix.** A true same-origin check (`Origin` against the server's own host
  *and* port) closes it without affecting the dashboard. Worth doing before the
  module is published widely.

**`compatibility.minimum` claims Foundry v13; only v14 has been exercised.** The
module's `plainText()` passes tag-free text through untouched, which is what
v13's plain textarea sends, and the v13 API fallbacks exist — but nobody has run
it there. `verified` says `14`, which is the honest claim.
