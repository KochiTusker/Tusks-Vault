import type { Request, Response, NextFunction } from "express";

// Loopback shapes we accept in Host / Origin headers. IPv6 may arrive
// bracketed (`[::1]`) or unbracketed (`::1`) depending on the client.
const LOOPBACK_HOST_RE = /^(127\.0\.0\.1|localhost|\[::1\]|::1)(:\d+)?$/i;
const LOOPBACK_ORIGIN_RE = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\]|::1)(:\d+)?$/i;

export interface HostOriginGuardOpts {
  // The bind address chosen at startup. When non-loopback (e.g. "0.0.0.0" or
  // a LAN IP), the user has explicitly opted out of localhost-only, so the
  // Host check is skipped ENTIRELY rather than widened — there is no set
  // of valid names to enumerate for an arbitrary LAN interface. The Origin
  // check on writes still applies, so drive-by browser POSTs from
  // non-loopback origins are still rejected, and loopbackOnly() still gates
  // the routes that act on the host.
  bindHost: string;
  // Exact paths whose cross-origin writes this guard delegates to a stricter
  // check further down the stack, instead of refusing them here.
  //
  // Only the MCP endpoint and the two pre-trust pairing calls belong on this
  // list, and they belong on it because they MUST work cross-origin: a GM
  // running Foundry on a LAN box or a hosted service loads a page whose origin
  // is not loopback, and that page is the only thing that can dial Vault.
  //
  // What replaces the check is narrower, not weaker. mcp/auth.ts allows only
  // origins that completed the pairing handshake — a set the user built one
  // approval at a time — where this guard allows any loopback origin at all.
  //
  // EXACT paths, never prefixes. A prefix would silently cover the pairing
  // APPROVAL route the moment someone added one under the same namespace, and
  // a page that can both request and approve its own pairing has paired
  // itself.
  crossOriginPaths?: string[];
}

function isLoopback(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

function originHost(originOrReferer: string): string {
  // Origin is scheme://host[:port]; Referer can include a path. Match the
  // scheme+authority slice so the loopback test ignores the path.
  const m = originOrReferer.match(/^(https?:\/\/[^/]+)/i);
  return m ? m[1] : originOrReferer;
}

/**
 * Closes the DNS-rebinding hole. Express binds to 127.0.0.1 by default, but
 * a browser visiting `evil.example` that DNS-rebinds the hostname to
 * 127.0.0.1 can then fetch the dashboard's API with the rebound hostname in
 * the `Host` header — CORS doesn't help because the request is same-origin
 * from the browser's point of view.
 *
 * This middleware rejects any request whose `Host` header isn't a loopback
 * literal (when the server is bound to loopback), and any non-GET whose
 * `Origin`/`Referer`, if present, isn't a loopback origin. GETs with absent
 * Origin (direct nav, image tag) are allowed because the response body is
 * already not readable cross-origin under CORS.
 */
export function hostOriginGuard(opts: HostOriginGuardOpts) {
  const enforceHost = isLoopback(opts.bindHost);
  const delegated = new Set(opts.crossOriginPaths ?? []);
  return (req: Request, res: Response, next: NextFunction): void => {
    const host = ((req.headers.host as string | undefined) ?? "").trim();
    if (enforceHost && !LOOPBACK_HOST_RE.test(host)) {
      res.status(403).json({
        error: "Forbidden: dashboard is bound to localhost and refused a non-loopback Host header.",
      });
      return;
    }

    if (
      req.method !== "GET" &&
      req.method !== "HEAD" &&
      req.method !== "OPTIONS" &&
      !delegated.has(req.path)
    ) {
      const raw = ((req.headers.origin as string | undefined) ??
                   (req.headers.referer as string | undefined) ??
                   "").trim();
      if (raw && !LOOPBACK_ORIGIN_RE.test(originHost(raw))) {
        res.status(403).json({
          error: "Forbidden: cross-origin write requests are not allowed.",
        });
        return;
      }
    }

    next();
  };
}
