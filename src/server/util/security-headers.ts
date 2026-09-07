import type { Request, Response, NextFunction } from "express";

// Minimal hardening headers. Not a full `helmet` install — for a local-dev
// dashboard the four headers below cover the realistic browser attack
// surface without the helmet dependency.
//
//   X-Frame-Options: DENY
//     The dashboard must never be embedded in an iframe. Combined with the
//     host/origin guard, this closes the "clickjacking on top of a rebound
//     loopback page" angle.
//
//   X-Content-Type-Options: nosniff
//     Forces browsers to honour declared Content-Type instead of MIME-sniffing
//     responses (which can promote a text response into an executable script
//     under unlikely-but-possible circumstances).
//
//   Referrer-Policy: no-referrer
//     The dashboard handles secret-bearing URLs (provider model lists, etc.).
//     Suppressing the Referer prevents accidental leakage to third-party
//     domains the user navigates to from inside the dashboard.
//
//   Content-Security-Policy
//     Strict in production, permissive in development. The dev mode allows
//     'unsafe-inline'/'unsafe-eval' + ws: because Vite HMR needs them; in
//     production Vite emits a bundled JS file and we lock back down.
//
//     KNOWN, AS OF v1.0.0: PROD_CSP DOES NOT CURRENTLY RUN ANYWHERE.
//     The caller passes `isDev: process.env.NODE_ENV !== "production"`, and
//     nothing in the project sets NODE_ENV — `npm start` is byte-identical to
//     `npm run dev`, and neither run.sh nor run.bat sets it or builds. So every
//     install serves DEV_CSP, and PROD_CSP below is unreached code.
//
//     What that does and does not cost: `script-src` is `'self'` in BOTH
//     policies, so third-party scripts are blocked either way — what a real
//     install loses is only the ban on inline scripts and eval. There is no
//     known XSS sink to pair that with (the single rehypeRaw call renders
//     repo-shipped markdown reached through a fixed slug→path map, never lore,
//     model output or user content), so this is a missing layer of defence in
//     depth rather than a live hole.
//
//     Deliberately not fixed on release eve: making the modes real means
//     `npm start` serves dist/, which requires a build step the documented
//     install does not perform, so the fix would break a fresh install to
//     harden a layer nothing currently needs. Tracked in
//     docs/troubleshooting/known-issues.md and slated for v1.0.1. Do not
//     delete PROD_CSP to "remove dead code" — it is the target state.

const PROD_CSP = [
  "default-src 'self'",
  // Scripts are bundled by Vite — no inline, no eval allowed.
  "script-src 'self'",
  // Tailwind + JSX style props can produce inline styles, and the dashboard
  // imports Google Fonts via @import in src/index.css. Allow both.
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data: blob:",
  "font-src 'self' data: https://fonts.gstatic.com",
  // The dashboard only fetches its own backend. Provider API calls happen
  // server-side, so the browser never directly hits Anthropic/OpenAI/Gemini.
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const DEV_CSP = [
  "default-src 'self'",
  // Vite injects HMR client + dev-only inline scripts. 'unsafe-eval' is also
  // needed because Vite evaluates module updates dynamically.
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data: blob:",
  "font-src 'self' data: https://fonts.gstatic.com",
  // ws:/wss: for the HMR WebSocket, which connects to the same origin Vite
  // is mounted on. Same loopback-only stance as the rest of the app.
  "connect-src 'self' ws: wss:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

export interface SecurityHeadersOpts {
  /** True when running under `tsx server.ts` / `npm run dev` (Vite HMR is
   *  hooked up). False under `NODE_ENV=production` — which nothing currently
   *  sets, so in practice this is always true. See the note above. */
  isDev: boolean;
}

export function securityHeaders(opts: SecurityHeadersOpts = { isDev: false }) {
  const csp = opts.isDev ? DEV_CSP : PROD_CSP;
  return (_req: Request, res: Response, next: NextFunction): void => {
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Content-Security-Policy", csp);
    next();
  };
}
