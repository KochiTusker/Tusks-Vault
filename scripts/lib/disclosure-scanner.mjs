// Disclosure layer: prose that tells a reader about the project's defences
// rather than about its code.
//
// Every other layer in this suite asks "is a secret present?". This one asks
// a different question: "does this text point a reader at something worth
// looking for, and roughly where?" Prose of that kind contains no secret at
// all. It is a search query.
//
// Round the patterns tight. A layer that fires on ordinary security
// commentary gets switched off, and then it protects nothing — this codebase
// legitimately discusses loopback binding, key handling and log redaction,
// because those are features that protect the USER and are worth documenting.
// What is caught here is narrower: prose about the project's own publication
// process, rather than about the code a reader is reading.
//
// SCOPE: comments and Markdown, not code.
// A first attempt scanned every line of every file and produced 26 findings,
// of which roughly two were real. The rest were import paths naming a module,
// the words allowlist/denylist used as ordinary vocabulary, and a test called
// "keeps hyphens that are part of the real name" about lore filenames. A
// layer with that signal-to-noise ratio gets switched off within a week. The
// risk being managed here lives in PROSE, so that is what gets read: comment
// lines in code files, every line in Markdown.

/** Source files whose non-comment lines are code, not prose. */
const CODE_FILE = /\.(ts|tsx|mjs|cjs|js|jsx|sh|bat|ps1|ya?ml|toml)$/i;
/** Leading comment markers across the languages in this tree, plus the
 *  extension-less `scripts/hooks/pre-push` shell script. */
const COMMENT_LINE = /^\s*(\/\/|\/\*|\*\/|\*|#|REM\b|::)/i;

/** Patterns, each with why it matters. Ordered most to least severe. */
const PATTERNS = [
  // Leak archaeology. The worst of the set: names a release, a count, or a
  // file class, which narrows a history search from "everything" to "this".
  {
    re: /\bv?\d+\.\d+\.\d+\b[^.\n]{0,60}\b(shipped|leaked|contained|exposed|carried)\b/i,
    why: "ties a version number to a described incident",
  },
  {
    re: /\b(shipped|leaked|exposed)\b[^.\n]{0,40}\b(real|actual)\s+(first\s+)?names?\b/i,
    why: "asserts that identifying data was published",
  },
  {
    re: /\b\d{1,4}\s+occurrences?\b[^.\n]{0,40}\bnames?\b/i,
    why: "quantifies a past exposure",
  },
  {
    re: /\bused to (carry|contain|hold)\b[^.\n]{0,50}\b(name|player|personal|private|real)\b/i,
    why: "says what a file used to contain",
  },
  {
    // Incident archaeology told as a story. "Found in the wild: ..." reads as
    // helpful background, which is why two human reviewers walked past it,
    // and it narrows a history search exactly like a version number does.
    re: /\bfound in the wild\b|\bonce (?:hid|leaked|shipped|exposed|contained|carried)\b/i,
    why: "narrates a past incident rather than current behaviour",
  },

  // Concealment announced. Harmless to do; harmful to explain.
  {
    re: /\b(so|because)\b[^.\n]{0,40}\b(timezone|time zone|geolocation|location)\b[^.\n]{0,30}\b(leak|reveal|infer|give away|tell)\w*/i,
    why: "explains why a value is normalised, not just that it is",
  },
  {
    // Both word orders. The original pattern required
    // "so ... timezone ... leak", and the sentence that actually shipped for a
    // year read "so a release commit doesn't leak the maintainer's local
    // timezone" — same claim, reversed, and therefore invisible.
    re: /\b(so|because)\b[^.\n]{0,50}\b(leak|reveal|infer|expose|give away)\w*\b[^.\n]{0,40}\b(timezone|time zone|geolocation|location|whereabouts)\b/i,
    why: "explains why a value is normalised, not just that it is",
  },
  {
    re: /\b(hide|hides|hiding|mask|masks|obscure|obscures|camouflage)\b[^.\n]{0,50}\b(identity|name|author|maintainer|location|timezone)\b/i,
    why: "describes concealing an attribute rather than the mechanism",
  },
  {
    re: /\bkeep(?:ing)?\b[^.\n]{0,40}\boff the internet\b/i,
    why: "states an intent to keep something unpublished",
  },
  {
    // Anonymity is only a signal when it is the AUTHOR'S. Offering a security
    // reporter the choice to stay anonymous is ordinary disclosure practice
    // and appears in every SECURITY.md worth having — so the phrase must sit
    // next to a word naming the project or its author before it fires.
    re: /\b(privacy stance|name-free)\b|\b(anonymit(y|ies)|anonymous|cannot be traced|can't be traced|pseudonym\w*)\b[^.\n]{0,40}\b(author|maintainer|owner|identity|project|branding|handle)\b|\b(author|maintainer|owner|identity|project|branding|handle)\b[^.\n]{0,40}\b(anonymit(y|ies)|anonymous|cannot be traced|can't be traced|pseudonym\w*)\b/i,
    why: "announces a posture rather than documenting behaviour",
  },
  {
    re: /\bso (that )?(nobody|no one|a reader|an attacker)\b[^.\n]{0,40}\b(can tell|knows|finds|works out)\b/i,
    why: "explains what the reader is meant not to learn",
  },

  // The defences themselves, named.
  {
    // The specific names only. `denylist` on its own is ordinary vocabulary —
    // this tree uses it to contrast with `allowlist` when choosing a file
    // filter — so it fires only next to a word about people or identity.
    re: /\b(private[- ]names|osint[- ]canar\w*|canar(y|ies))\b|\bdeny-?list\b[^.\n]{0,40}\b(name|identity|person|people|maintainer|author)\w*\b|\b(name|identity|person|people|maintainer|author)\w*\b[^.\n]{0,40}\bdeny-?list\b/i,
    why: "names the identity-protection tooling",
  },
  {
    // `opsec` is here because the nickname reached the public mirror twice
    // while only the formal term was matched.
    re: /\b(pre-push (hook|gate)|push gate|release gate|secret scanner|opsec|OSINT)\b/i,
    why: "names publication tooling",
  },
  {
    // Narrow on purpose: the dev remote's EXISTENCE is an accepted, documented
    // exposure (the dev-mode updater references it by name in shipped source).
    // What must not ship is prose pairing the dev repo with its access
    // control or credentials.
    re: /\b(dev|private) repo(sitory)?\b[^.\n]{0,30}\b(credentials?|token|secret|password)\b/i,
    why: "pairs the private counterpart repository with its access control",
  },
];

/** Files this layer cannot usefully scan, kept as small as the truth allows.
 *
 *  The previous list exempted the whole scanner suite on the grounds that it
 *  was "dev-visible context, not a secret". That reasoning did not survive
 *  publication: these files ship, so their comments are read by exactly the
 *  audience this layer exists for. The list below rests on a claim that is
 *  still true after publication instead — these files ARE the publication
 *  tooling, and a comment in the pre-push hook naming the pre-push hook tells
 *  a reader nothing the filename has not already told them.
 *
 *  Everything else that used to sit here is now scanned: the gitleaks config,
 *  the CI workflow, the exclusion list, the hook installer, the fast-forward
 *  guard and the shared file-type helpers.
 *
 *  Note what this exemption does NOT cover: prose in these files about the
 *  author rather than about the tooling. That is caught by review, and the
 *  reason the comments here were rewritten rather than merely exempted. */
const EXEMPT_FILE = /^(SECURITY\.md|docs\/Privacy\.md|scripts\/(audit-[a-z-]+|release-to-public|verify-parity|hooks\/pre-push)(\.test)?(\.mjs)?|scripts\/lib\/(disclosure-scanner|private-names|secret-scanner|personal-info-scanner|scanners\.test)\.mjs|\.private-names\.example|\.gitignore)$/;

/**
 * Scan one file's content.
 * @returns findings shaped like every other layer in this suite.
 */
export function scanLinesForDisclosure(file, content, commit = "") {
  // Path separators are normalised without a regex literal on purpose: an
  // escaped backslash is the construct that keeps getting mangled in this
  // tree, and it is not worth another incident to save a line.
  const norm = String(file).split(String.fromCharCode(92)).join("/");
  if (EXEMPT_FILE.test(norm)) return [];
  const proseOnly = CODE_FILE.test(norm) || norm.endsWith("pre-push");
  const findings = [];
  const lines = String(content).split(/\r?\n/);
  lines.forEach((line, i) => {
    if (line.length > 400) return;
    if (proseOnly && !COMMENT_LINE.test(line)) return;
    for (const { re, why } of PATTERNS) {
      if (re.test(line)) {
        findings.push({
          layer: "disclosure",
          file,
          commit,
          detail: `line ${i + 1}: ${why} — "${line.trim().slice(0, 90)}"`,
        });
        break;
      }
    }
  });
  return findings;
}
