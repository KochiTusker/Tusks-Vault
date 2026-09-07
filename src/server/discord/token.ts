// What can be automated about Discord bot setup, and what cannot.
//
// CANNOT, at all: creating the application, creating its bot user, issuing a
// token, and enabling the Message Content Intent. Discord exposes no API for
// any of them — application management is Developer Portal UI only, and there
// is no OAuth scope that grants it. Anything claiming otherwise is driving a
// browser session, which would mean handling the maintainer's Discord
// password. So those four steps stay manual, and the honest thing is to make
// them short and unambiguous rather than pretend to remove them.
//
// CAN be automated, and is, here:
//   - deriving the Application ID from the token, which removes an entire
//     step and the most common way to get setup wrong (pasting the Public Key
//     or the Client Secret into the App ID box — both are hex strings of
//     plausible length that fail silently later)
//   - checking the token actually works, and saying which bot it belongs to,
//     BEFORE writing it to disk
//   - naming the Message Content Intent explicitly, because a bot without it
//     connects, appears online, and receives every message with empty content
//     — which looks like a broken app rather than a missing checkbox

/** A bot token is three base64url segments joined by dots:
 *    base64url(bot user id) . base64url(token creation timestamp) . hmac
 *  Only the first is useful to us. */
const TOKEN_SHAPE = /^([A-Za-z0-9_-]{16,})\.([A-Za-z0-9_-]{5,})\.([A-Za-z0-9_-]{20,})$/;

/** Discord snowflakes are 64-bit integers rendered as decimal digits. They are
 *  17–20 digits for every id issued to date and for the foreseeable future
 *  (the epoch would need to advance by centuries to reach 21). */
const SNOWFLAKE = /^\d{17,20}$/;

export interface TokenInspection {
  /** The token is shaped like a bot token. Says nothing about validity. */
  wellFormed: boolean;
  /** The bot user's id, decoded from the first segment. For a bot user this
   *  IS the Application ID — Discord issues the bot user the same snowflake
   *  as its application. */
  appId: string | null;
  reason?: string;
}

/**
 * Read the Application ID out of a bot token, without a network call.
 *
 * This is not a trick or an undocumented detail — the first segment is the
 * bot user's id, base64url-encoded, and a bot user's id equals its
 * application's id. It means the user pastes one secret instead of a secret
 * and an id, and cannot mismatch them.
 */
export function inspectToken(raw: string): TokenInspection {
  const token = (raw ?? "").trim();
  if (!token) return { wellFormed: false, appId: null, reason: "No token given." };

  // A token pasted with the "Bot " prefix Discord's docs use in headers is a
  // common and entirely reasonable mistake.
  const cleaned = token.replace(/^Bot\s+/i, "");

  const m = cleaned.match(TOKEN_SHAPE);
  if (!m) {
    return {
      wellFormed: false,
      appId: null,
      reason:
        "That doesn't look like a bot token. A bot token is three parts separated by dots. " +
        "If what you copied is a long hex string, it's probably the Public Key or Client Secret — " +
        "the token is on the Bot tab, behind Reset Token.",
    };
  }

  let decoded: string;
  try {
    decoded = Buffer.from(m[1], "base64url").toString("utf-8");
  } catch {
    return { wellFormed: true, appId: null, reason: "Could not read the application id from the token." };
  }
  if (!SNOWFLAKE.test(decoded)) {
    // Shaped right, but the first segment isn't a snowflake — a user token or
    // something else entirely. Report no id rather than a wrong one.
    return {
      wellFormed: true,
      appId: null,
      reason: "The token's first part isn't an application id — is this a bot token?",
    };
  }
  return { wellFormed: true, appId: decoded };
}

/** Strip a leading `Bot ` and surrounding whitespace. What actually gets
 *  written to .env.local. */
export function normaliseToken(raw: string): string {
  return (raw ?? "").trim().replace(/^Bot\s+/i, "");
}

export interface TokenVerdict {
  ok: boolean;
  /** The bot's username, so the user can confirm it is the one they meant. */
  botName?: string;
  botId?: string;
  appId?: string;
  error?: string;
}

/**
 * Ask Discord whether the token works, before we store it.
 *
 * Saving an invalid token and letting the gateway fail later means the error
 * surfaces in a log, minutes later, detached from the action that caused it.
 * One HTTP call turns that into an immediate, specific answer.
 */
export async function verifyToken(
  raw: string,
  fetchImpl: typeof fetch = fetch
): Promise<TokenVerdict> {
  const token = normaliseToken(raw);
  const inspection = inspectToken(token);
  if (!inspection.wellFormed) return { ok: false, error: inspection.reason };

  let res: Response;
  try {
    res = await fetchImpl("https://discord.com/api/v10/users/@me", {
      headers: { Authorization: `Bot ${token}` },
    });
  } catch (err) {
    return { ok: false, error: `Could not reach Discord: ${(err as Error).message}` };
  }

  if (res.status === 401) {
    return {
      ok: false,
      error:
        "Discord rejected this token. If you copied it a while ago it may have been reset — " +
        "generate a new one on the Bot tab and paste that.",
    };
  }
  if (!res.ok) {
    return { ok: false, error: `Discord answered HTTP ${res.status}.` };
  }

  const me = (await res.json().catch(() => ({}))) as { id?: string; username?: string; bot?: boolean };
  if (!me.id) return { ok: false, error: "Discord's reply did not identify the bot." };
  if (me.bot !== true) {
    // A user token would authenticate but must never be used here: automating
    // a user account is against Discord's terms and gets the account banned.
    return {
      ok: false,
      error: "That token belongs to a user account, not a bot. Use the token from your application's Bot tab.",
    };
  }
  return {
    ok: true,
    botName: me.username,
    botId: me.id,
    // Prefer Discord's own answer over our decode; they agree, and if they
    // ever did not, the authoritative one should win.
    appId: me.id ?? inspection.appId ?? undefined,
  };
}
