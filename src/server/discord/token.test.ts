import { describe, expect, it, vi } from "vitest";
import { inspectToken, normaliseToken, verifyToken } from "./token";

/** Build a syntactically valid bot token for a given snowflake. The secret
 *  segments are arbitrary — nothing here is or resembles a real credential. */
function fakeToken(appId: string, tail = "abcdefghijklmnopqrstuvwxyz012345"): string {
  const first = Buffer.from(appId, "utf-8").toString("base64url");
  return `${first}.Gm4Xyz.${tail}`;
}

const APP_ID = "123456789012345678";

describe("inspectToken", () => {
  it("recovers the application id from a well-formed token", () => {
    // The whole reason the App ID field can disappear from the setup flow.
    const r = inspectToken(fakeToken(APP_ID));
    expect(r.wellFormed).toBe(true);
    expect(r.appId).toBe(APP_ID);
  });

  it("tolerates the `Bot ` prefix from Discord's own docs", () => {
    expect(inspectToken(`Bot ${fakeToken(APP_ID)}`).appId).toBe(APP_ID);
    expect(inspectToken(`bot   ${fakeToken(APP_ID)}`).appId).toBe(APP_ID);
  });

  it("tolerates surrounding whitespace from a sloppy copy", () => {
    expect(inspectToken(`  ${fakeToken(APP_ID)}\n`).appId).toBe(APP_ID);
  });

  it("names the likely mistake when given a hex string", () => {
    // The Public Key and Client Secret sit near the token in the portal and
    // are both plausible-looking hex. Pasting one used to fail silently much
    // later, at gateway login.
    const r = inspectToken("a".repeat(64));
    expect(r.wellFormed).toBe(false);
    expect(r.reason).toMatch(/Public Key|Client Secret/);
  });

  it("rejects empty input", () => {
    expect(inspectToken("").wellFormed).toBe(false);
    expect(inspectToken("   ").wellFormed).toBe(false);
  });

  it("reports no id — rather than a wrong one — when the first part isn't a snowflake", () => {
    // Shaped like a token, but the first segment decodes to something else.
    // Guessing here would write a bad App ID into the invite URL, which then
    // fails with an error that points nowhere near the cause.
    const bogus = `${Buffer.from("not-a-snowflake", "utf-8").toString("base64url")}.Gm4Xyz.${"z".repeat(30)}`;
    const r = inspectToken(bogus);
    expect(r.wellFormed).toBe(true);
    expect(r.appId).toBeNull();
  });

  it("rejects a two-segment string", () => {
    expect(inspectToken("abcdefghijklmnop.Gm4Xyz").wellFormed).toBe(false);
  });

  it("accepts the full snowflake width range", () => {
    for (const id of ["1".repeat(17), "1".repeat(20)]) {
      expect(inspectToken(fakeToken(id)).appId, id).toBe(id);
    }
  });
});

describe("normaliseToken", () => {
  it("strips the prefix and whitespace, leaving the token itself", () => {
    const t = fakeToken(APP_ID);
    expect(normaliseToken(`  Bot ${t}  `)).toBe(t);
    expect(normaliseToken(t)).toBe(t);
  });
});

describe("verifyToken", () => {
  const okResponse = (body) => ({ ok: true, status: 200, json: async () => body });

  it("confirms a working token and names the bot", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ id: APP_ID, username: "Tusk", bot: true }));
    const v = await verifyToken(fakeToken(APP_ID), fetchMock);
    expect(v.ok).toBe(true);
    expect(v.botName).toBe("Tusk");
    expect(v.appId).toBe(APP_ID);
  });

  it("sends the token as a Bot authorization header", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ id: APP_ID, username: "Tusk", bot: true }));
    const t = fakeToken(APP_ID);
    await verifyToken(t, fetchMock);
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe(`Bot ${t}`);
  });

  it("does not call Discord at all for a malformed token", async () => {
    // No point spending a round-trip, and no point handing Discord a string
    // the user clearly pasted from the wrong field.
    const fetchMock = vi.fn();
    const v = await verifyToken("not-a-token", fetchMock);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(v.ok).toBe(false);
  });

  it("explains a 401 as a possibly-reset token", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });
    const v = await verifyToken(fakeToken(APP_ID), fetchMock);
    expect(v.ok).toBe(false);
    expect(v.error).toMatch(/reset/);
  });

  it("REFUSES a user token even though it authenticates", async () => {
    // Automating a user account violates Discord's terms and gets the account
    // banned. It authenticates fine, so nothing else would catch it.
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ id: APP_ID, username: "someone", bot: false }));
    const v = await verifyToken(fakeToken(APP_ID), fetchMock);
    expect(v.ok).toBe(false);
    expect(v.error).toMatch(/user account/);
  });

  it("treats a reply with no id as a failure rather than a success", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({}));
    expect((await verifyToken(fakeToken(APP_ID), fetchMock)).ok).toBe(false);
  });

  it("reports a network failure without throwing", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("ENOTFOUND"));
    const v = await verifyToken(fakeToken(APP_ID), fetchMock);
    expect(v.ok).toBe(false);
    expect(v.error).toMatch(/Could not reach Discord/);
  });

  it("reports an unexpected status with its code", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });
    expect((await verifyToken(fakeToken(APP_ID), fetchMock)).error).toMatch(/503/);
  });

  it("never puts the token in the error text", async () => {
    // Errors are surfaced in the dashboard and written to the log.
    const t = fakeToken(APP_ID);
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });
    const v = await verifyToken(t, fetchMock);
    expect(v.error).not.toContain(t);
  });
});
