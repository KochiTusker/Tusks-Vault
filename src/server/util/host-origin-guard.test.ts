import { describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { hostOriginGuard } from "./host-origin-guard";

function makeReq(overrides: Partial<{ method: string; host: string; origin: string; referer: string }>): Request {
  const headers: Record<string, string> = {};
  if (overrides.host !== undefined) headers.host = overrides.host;
  if (overrides.origin !== undefined) headers.origin = overrides.origin;
  if (overrides.referer !== undefined) headers.referer = overrides.referer;
  return {
    method: overrides.method ?? "GET",
    headers,
  } as unknown as Request;
}

function makeRes(): { res: Response; status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> } {
  const status = vi.fn();
  const json = vi.fn();
  const res = { status, json } as unknown as Response;
  status.mockReturnValue(res);
  json.mockReturnValue(res);
  return { res, status, json };
}

describe("hostOriginGuard — Host header check (loopback bind)", () => {
  const guard = hostOriginGuard({ bindHost: "127.0.0.1" });

  it("allows requests with Host: 127.0.0.1:<port>", () => {
    const next = vi.fn();
    const { res, status } = makeRes();
    guard(makeReq({ host: "127.0.0.1:3000" }), res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(status).not.toHaveBeenCalled();
  });

  it("allows requests with Host: localhost:<port>", () => {
    const next = vi.fn();
    const { res, status } = makeRes();
    guard(makeReq({ host: "localhost:3000" }), res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(status).not.toHaveBeenCalled();
  });

  it("allows requests with Host: [::1]:<port>", () => {
    const next = vi.fn();
    const { res, status } = makeRes();
    guard(makeReq({ host: "[::1]:3000" }), res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(status).not.toHaveBeenCalled();
  });

  it("rejects requests with a rebound Host: evil.example", () => {
    const next = vi.fn();
    const { res, status, json } = makeRes();
    guard(makeReq({ host: "evil.example:3000" }), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining("loopback") }),
    );
  });

  it("rejects requests with an empty Host header", () => {
    const next = vi.fn();
    const { res, status } = makeRes();
    guard(makeReq({ host: "" }), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(403);
  });

  it("rejects requests with a public-IP Host", () => {
    const next = vi.fn();
    const { res, status } = makeRes();
    guard(makeReq({ host: "203.0.113.5:3000" }), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(403);
  });
});

describe("hostOriginGuard — Origin / Referer check on writes", () => {
  const guard = hostOriginGuard({ bindHost: "127.0.0.1" });

  it("allows POST with loopback Origin", () => {
    const next = vi.fn();
    const { res, status } = makeRes();
    guard(makeReq({ method: "POST", host: "localhost:3000", origin: "http://localhost:3000" }), res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(status).not.toHaveBeenCalled();
  });

  it("allows POST with no Origin header (local tools, fetch from same-origin)", () => {
    const next = vi.fn();
    const { res, status } = makeRes();
    guard(makeReq({ method: "POST", host: "localhost:3000" }), res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(status).not.toHaveBeenCalled();
  });

  it("rejects POST with a non-loopback Origin", () => {
    const next = vi.fn();
    const { res, status, json } = makeRes();
    guard(makeReq({ method: "POST", host: "localhost:3000", origin: "http://evil.example" }), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining("cross-origin") }),
    );
  });

  it("rejects PATCH with a non-loopback Referer (Origin absent)", () => {
    const next = vi.fn();
    const { res, status } = makeRes();
    guard(makeReq({ method: "PATCH", host: "localhost:3000", referer: "http://evil.example/index.html" }), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(403);
  });

  it("rejects DELETE with a non-loopback Referer", () => {
    const next = vi.fn();
    const { res, status } = makeRes();
    guard(makeReq({ method: "DELETE", host: "localhost:3000", referer: "https://attacker.test/abc" }), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(403);
  });

  it("does NOT check Origin on GET (CORS already blocks cross-origin reads)", () => {
    const next = vi.fn();
    const { res, status } = makeRes();
    guard(makeReq({ method: "GET", host: "localhost:3000", referer: "https://attacker.test/" }), res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(status).not.toHaveBeenCalled();
  });
});

describe("hostOriginGuard — non-loopback bind (HOST=0.0.0.0 opt-out)", () => {
  const guard = hostOriginGuard({ bindHost: "0.0.0.0" });

  it("permits any Host header when bound to 0.0.0.0", () => {
    const next = vi.fn();
    const { res, status } = makeRes();
    guard(makeReq({ host: "evil.example:3000" }), res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(status).not.toHaveBeenCalled();
  });

  it("still enforces loopback-Origin on writes even when bound to 0.0.0.0", () => {
    const next = vi.fn();
    const { res, status } = makeRes();
    guard(makeReq({ method: "POST", host: "lan.host:3000", origin: "http://attacker.test" }), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(403);
  });
});
