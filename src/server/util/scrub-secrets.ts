// Mask known secret shapes inside arbitrary strings (typically log lines).
// Order matters: more specific patterns (Anthropic's "sk-ant-…") MUST run
// before the more general OpenAI "sk-…" so an Anthropic key isn't half-masked.
//
// Each pattern is a conservative match for the shape the provider documents,
// so we don't redact unrelated text that happens to start with "sk-". False
// negatives (a leaked key that doesn't match) are acceptable for a best-effort
// log filter; false positives (a non-secret redacted to <redacted>) are
// annoying for debugging but never security-relevant.
const PATTERNS: RegExp[] = [
  // Anthropic — sk-ant-api03-… (variable suffix)
  /sk-ant-[A-Za-z0-9_-]{20,}/g,
  // OpenAI — sk-… and sk-proj-… (older keys ~51 chars, project keys 100+)
  // Lookahead: a digit or uppercase must appear in the run. Real keys always
  // have one; lowercase hyphenated prose does not. Kept identical to the
  // OpenAI pattern in scripts/audit-patterns.mjs — these two are a parallel
  // implementation and drifting them apart is how one starts missing what the
  // other catches.
  /sk-(?=[A-Za-z0-9_-]*[0-9A-Z])[A-Za-z0-9_-]{16,}/g,
  // Google AI Studio — AIzaSy… (39 chars total)
  /AIza[A-Za-z0-9_-]{35,}/g,
  // Discord bot token — base64url.base64url.base64url, conservative on the
  // first segment so we don't redact short identifiers separated by dots.
  /[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{27,}/g,
  // Slack tokens (bot, user, refresh, app, service).
  /xox[abpsr]-[A-Za-z0-9-]{10,}/g,
  // GitHub PATs and OAuth tokens (personal, OAuth, user-to-server,
  // server-to-server, refresh).
  /gh[poursa]_[A-Za-z0-9]{36,}/g,
  // AWS access key IDs — AKIA (long-lived) / ASIA (temporary).
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  // Stripe API keys — live + test, public + secret.
  /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{20,}\b/g,
  // JSON Web Tokens — the common accidentally-logged auth header.
  /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  // PEM armour line — the body that follows is already unreadable once the
  // header is masked, and multi-line log entries are rare.
  /-----BEGIN (?:RSA |DSA |EC |OPENSSH |ENCRYPTED |)PRIVATE KEY-----/g,
];
// ^ This list mirrors scripts/audit-patterns.mjs pattern-for-pattern — the
// same shapes, scanned at rest there and at log time here. The contracts
// audit (scripts/audit-security-contracts.mjs) asserts the two stay in sync;
// when adding a shape, add it in both files and test it in both suites.

export function scrubSecrets(s: string): string {
  let out = s;
  for (const re of PATTERNS) {
    out = out.replace(re, "<redacted>");
  }
  return out;
}
