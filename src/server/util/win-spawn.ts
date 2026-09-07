// Spawning a Windows `.cmd` shim without tripping DEP0190.
//
// The problem: on Windows, `spawn("claude", ["--version"])` cannot find
// `claude.cmd` — bare-name lookup does not consult PATHEXT — so the call needs
// `shell: true`. But Node 22+ emits
//
//   [DEP0190] DeprecationWarning: Passing args to a child process with shell
//   option true can lead to security vulnerabilities, as the arguments are not
//   escaped, only concatenated.
//
// on exactly that combination, because the runtime joins the args array into
// one command line with no escaping. The warning is correct about the general
// case and prints on every boot, which is a poor first impression for a tool
// whose whole pitch is that it is careful with your data.
//
// The fix is to do the escaping ourselves: build one pre-quoted command string
// and hand spawn an EMPTY args array. Nothing is concatenated unescaped,
// because nothing is concatenated by Node at all.
//
// This mirrors the approach already used by util/updater.ts. Kept here so the
// two cannot drift: a quoting rule that is right in one file and stale in the
// other is worse than one place to look.

/**
 * Quote a single argument for `cmd.exe`.
 *
 * Only quotes when the argument actually contains a character cmd treats
 * specially — an untouched `--version` stays readable in a process list — and
 * doubles any embedded quote, which is cmd's own escape, not backslash.
 */
export function quoteForCmd(arg: string): string {
  // An empty argument must still occupy a slot. Returning "" unquoted would
  // drop it from the command line entirely and silently shift every later
  // argument left by one.
  if (arg === "") return '""';
  if (!/[\s"&|<>()^%!]/.test(arg)) return arg;
  return `"${arg.replace(/"/g, '""')}"`;
}

export interface ShellSafeSpawn {
  /** Pass as spawn's first argument. */
  command: string;
  /** Pass as spawn's second argument — empty on Windows, by design. */
  args: string[];
  /** Pass as spawn's `shell` option. */
  shell: boolean;
}

/**
 * Build spawn arguments that resolve a `.cmd` shim on Windows without DEP0190.
 *
 * On every other platform this is a pass-through with `shell: false`, which is
 * both safer and faster — the shim problem is Windows-only, so the shell is
 * too.
 *
 * Callers still owe the usual duty of care: this makes the *mechanism* safe,
 * not the inputs. Request-derived values should be validated before they reach
 * argv regardless (see MODEL_RE in llm/claude-code-cli.ts).
 */
export function shellSafeSpawn(command: string, args: string[]): ShellSafeSpawn {
  if (process.platform !== "win32") return { command, args, shell: false };
  return {
    command: [command, ...args].map(quoteForCmd).join(" "),
    // The empty array is the safety property, not an implementation detail:
    // every argument was quoted by quoteForCmd into the string above, so Node
    // concatenates nothing here because there is nothing left to concatenate.
    args: [],
    // AUDIT: required on Windows to resolve a .cmd/.bat shim, which bare-name
    // spawn cannot find via PATHEXT. The injection class this rule guards is
    // closed by the pre-quoting above, not deferred to callers.
    shell: true,
  };
}
