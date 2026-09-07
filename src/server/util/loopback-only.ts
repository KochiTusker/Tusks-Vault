import { Request, Response, NextFunction } from "express";

// Gate for routes that act on the HOST machine — spawning a process, reading
// an arbitrary filesystem path, opening a native dialog.
//
// The global host/origin guard (util/host-origin-guard.ts) already rejects
// non-loopback Hosts *when the server is bound to loopback*. This is the
// second gate for the case that guard deliberately allows: HOST=0.0.0.0 is a
// documented option for running the dashboard on a home server, and under it
// a LAN visitor reaches every route. Reading lore over the LAN is the point.
// Spawning a CLI on the host is not.
//
// So this checks the SOCKET, not a header. Headers are attacker-controlled;
// the peer address is not.

function isLoopbackAddress(addr: string | undefined): boolean {
  if (!addr) return false;
  // Node reports IPv4-mapped IPv6 for dual-stack sockets.
  const a = addr.replace(/^::ffff:/, "");
  return a === "127.0.0.1" || a === "::1" || a.startsWith("127.");
}

export function loopbackOnly() {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (isLoopbackAddress(req.socket?.remoteAddress)) {
      next();
      return;
    }
    res.status(403).json({
      error:
        "This endpoint runs a program on the machine hosting Tusk's Vault, so it only accepts " +
        "requests from that machine. Open the dashboard on the host itself.",
    });
  };
}

export const _isLoopbackAddress = isLoopbackAddress;
