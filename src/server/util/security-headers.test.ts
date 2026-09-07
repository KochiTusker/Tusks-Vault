import { describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { securityHeaders } from "./security-headers";

function makeRes(): { res: Response; setHeader: ReturnType<typeof vi.fn>; headers: Map<string, string> } {
  const headers = new Map<string, string>();
  const setHeader = vi.fn((k: string, v: string) => { headers.set(k, v); });
  const res = { setHeader } as unknown as Response;
  return { res, setHeader, headers };
}

// Extract a single CSP directive (e.g. "script-src 'self'") so assertions can
// scope to that directive without false-positives from siblings (e.g. style-src
// using 'unsafe-inline' doesn't confuse a script-src check).
function directiveFor(csp: string, name: string): string {
  return csp.split(";").map(d => d.trim()).find(d => d.startsWith(name + " ")) ?? "";
}

describe("securityHeaders — universal headers", () => {
  it("sets X-Frame-Options: DENY to block clickjacking", () => {
    const { res, headers } = makeRes();
    securityHeaders()({} as Request, res, vi.fn());
    expect(headers.get("X-Frame-Options")).toBe("DENY");
  });

  it("sets X-Content-Type-Options: nosniff to disable MIME sniffing", () => {
    const { res, headers } = makeRes();
    securityHeaders()({} as Request, res, vi.fn());
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("sets Referrer-Policy: no-referrer", () => {
    const { res, headers } = makeRes();
    securityHeaders()({} as Request, res, vi.fn());
    expect(headers.get("Referrer-Policy")).toBe("no-referrer");
  });

  it("calls next() so the response is not short-circuited", () => {
    const { res } = makeRes();
    const next = vi.fn();
    securityHeaders()({} as Request, res, next);
    expect(next).toHaveBeenCalledOnce();
  });
});

describe("securityHeaders — CSP, production mode", () => {
  function prodCsp(): string {
    const { res, headers } = makeRes();
    securityHeaders({ isDev: false })({} as Request, res, vi.fn());
    return headers.get("Content-Security-Policy") ?? "";
  }

  it("locks script-src to self only (no unsafe-inline, no unsafe-eval)", () => {
    const directive = directiveFor(prodCsp(), "script-src");
    expect(directive).toContain("'self'");
    expect(directive).not.toContain("unsafe-inline");
    expect(directive).not.toContain("unsafe-eval");
  });

  it("allows Google Fonts as a deliberate exception", () => {
    expect(prodCsp()).toContain("fonts.googleapis.com");
    expect(prodCsp()).toContain("fonts.gstatic.com");
  });

  it("denies framing (frame-ancestors 'none')", () => {
    expect(prodCsp()).toContain("frame-ancestors 'none'");
  });

  it("scopes connect-src to self only (no ws: in prod)", () => {
    const directive = directiveFor(prodCsp(), "connect-src");
    expect(directive).toContain("'self'");
    expect(directive).not.toMatch(/\bws:/);
    expect(directive).not.toMatch(/\bwss:/);
  });

  it("locks form-action + base-uri to self", () => {
    const csp = prodCsp();
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
  });
});

describe("securityHeaders — CSP, development mode", () => {
  function devCsp(): string {
    const { res, headers } = makeRes();
    securityHeaders({ isDev: true })({} as Request, res, vi.fn());
    return headers.get("Content-Security-Policy") ?? "";
  }

  it("allows 'unsafe-inline' and 'unsafe-eval' for Vite HMR scripts", () => {
    const csp = devCsp();
    expect(csp).toMatch(/script-src[^;]*'unsafe-inline'/);
    expect(csp).toMatch(/script-src[^;]*'unsafe-eval'/);
  });

  it("allows ws: / wss: connections for HMR WebSocket", () => {
    const csp = devCsp();
    expect(csp).toMatch(/connect-src[^;]*ws:/);
    expect(csp).toMatch(/connect-src[^;]*wss:/);
  });

  it("still denies framing in dev (frame-ancestors 'none')", () => {
    expect(devCsp()).toContain("frame-ancestors 'none'");
  });
});

describe("securityHeaders — default (no opts) is production", () => {
  it("defaults isDev=false when no opts are passed", () => {
    const { res, headers } = makeRes();
    securityHeaders()({} as Request, res, vi.fn());
    const csp = headers.get("Content-Security-Policy") ?? "";
    const scriptDirective = directiveFor(csp, "script-src");
    const connectDirective = directiveFor(csp, "connect-src");
    expect(scriptDirective).not.toContain("unsafe-eval");
    expect(connectDirective).not.toMatch(/\bws:/);
  });
});
