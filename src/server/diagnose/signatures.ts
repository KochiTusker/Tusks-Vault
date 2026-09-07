// Soft-error signatures — the failure modes that DON'T throw.
//
// A hard error lands in a stack trace; these are the quieter ways a Vault
// install goes wrong: retrieval silently degrading, the lore folder
// resolving somewhere unexpected, a stored key the provider has started
// rejecting. Each signature is a pure function over a state snapshot so it
// can be tested with a positive and a negative fixture, and the bundle can
// run the whole list without touching the world.
//
// Add new signatures here as new failure modes are discovered — that is the
// point of the file.

export interface DiagnoseState {
  /** Clarification rows with/without stored vectors. */
  clarifications: Array<{ id: string; embedded: boolean }>;
  /** Lore-folder resolution as reported by config/paths. */
  lore: {
    resolution: "env" | "settings" | "sibling" | "fallback";
    loreRootExists: boolean;
    defaultSiblingExists: boolean;
    documentCount: number;
  };
  /** Last stored-key test outcomes, when the dashboard has run them. */
  keyTests: Array<{ label: string; provider: string; ok: boolean; error?: string }>;
  /** package-lock newer than node_modules (boot-time check result). */
  nodeModulesStale: boolean;
  /** The configured models and whether the provider's list contains them. */
  modelReachability: { proModel: string; flashModel: string; listed: string[] | null };
  /** Bot connection state string from the Discord client. */
  botStatus: string;
  discordTokenConfigured: boolean;
}

export interface Signature {
  id: string;
  title: string;
  /** Return a one-paragraph diagnosis when the signature fires, else null. */
  matches(state: DiagnoseState): string | null;
}

export const SIGNATURES: Signature[] = [
  {
    id: "clarifications_unembedded",
    title: "Clarifications without embeddings",
    matches(s) {
      const missing = s.clarifications.filter(c => !c.embedded);
      if (missing.length === 0) return null;
      return (
        `${missing.length} of ${s.clarifications.length} clarification(s) have no stored vector, so ` +
        `semantic retrieval cannot match them — they are invisible to the bot unless the question ` +
        `matches almost word-for-word. The startup backfill should embed them on the next boot; if ` +
        `this persists across restarts, the embedding model is failing to load.`
      );
    },
  },
  {
    id: "lore_fallback_with_sibling_present",
    title: "Lore resolution fell back while a sibling folder exists",
    matches(s) {
      if (s.lore.resolution !== "fallback" || !s.lore.defaultSiblingExists) return null;
      return (
        `The lore folder resolved to the repo-local ./Lore fallback, but a sibling Tusks-Lore/ ` +
        `folder EXISTS and was not used. The bot is answering from a different document set than ` +
        `the one being edited. Restart the server (resolution happens once at boot), and if it ` +
        `persists check loreFolderPath in settings.json and TUSKS_VAULT_LORE_PATH.`
      );
    },
  },
  {
    id: "lore_root_missing",
    title: "Resolved lore folder does not exist",
    matches(s) {
      if (s.lore.loreRootExists) return null;
      return (
        `The configured lore folder does not exist on disk — every answer is running against an ` +
        `empty knowledge base. Check loreFolderPath in settings.json (or the TUSKS_VAULT_LORE_PATH ` +
        `env var) for a moved or renamed folder.`
      );
    },
  },
  {
    id: "empty_knowledge_base",
    title: "Zero documents indexed",
    matches(s) {
      if (!s.lore.loreRootExists || s.lore.documentCount > 0) return null;
      return (
        `The lore folder exists but holds zero indexable documents. The bot will answer every ` +
        `lore question with the unsure-phrase. Supported types: PDF, DOCX, TXT, MD, JSON.`
      );
    },
  },
  {
    id: "stored_key_rejected",
    title: "A stored key is being rejected by its provider",
    matches(s) {
      const failing = s.keyTests.filter(t => !t.ok);
      if (failing.length === 0) return null;
      return failing
        .map(
          t =>
            `Key "${t.label}" (${t.provider}) fails its provider check: ${t.error ?? "unknown error"}. ` +
            `If it is the active key, every question errors. Rotate or re-enter it in Settings → API keys.`
        )
        .join("\n");
    },
  },
  {
    id: "node_modules_stale",
    title: "Dependencies older than the lockfile",
    matches(s) {
      if (!s.nodeModulesStale) return null;
      return (
        `package-lock.json is newer than node_modules — a previous update pulled new dependency ` +
        `versions that were never installed. Stop the server, run npm install, and start it again.`
      );
    },
  },
  {
    id: "configured_model_unlisted",
    title: "Configured model not in the provider's list",
    matches(s) {
      const listed = s.modelReachability.listed;
      if (listed === null || listed.length === 0) return null;
      const missing = [s.modelReachability.proModel, s.modelReachability.flashModel].filter(
        m => m && !listed.includes(m)
      );
      if (missing.length === 0) return null;
      return (
        `The configured model(s) ${missing.map(m => `"${m}"`).join(", ")} do not appear in the ` +
        `active provider's model list — calls may 404 or silently substitute. Re-pick the model in ` +
        `the Home tab's Active Provider card.`
      );
    },
  },
  {
    id: "discord_configured_but_offline",
    title: "Token configured but the bot is not online",
    matches(s) {
      if (!s.discordTokenConfigured || s.botStatus === "Online") return null;
      return (
        `A Discord token is configured but the client reports "${s.botStatus}". Usual causes: the ` +
        `token was reset in the Developer Portal, or Message Content Intent is disabled. ` +
        `Re-save a fresh token via the Home tab's Discord setup.`
      );
    },
  },
];

export function runSignatures(state: DiagnoseState): Array<{ id: string; title: string; detail: string }> {
  const out: Array<{ id: string; title: string; detail: string }> = [];
  for (const sig of SIGNATURES) {
    const detail = sig.matches(state);
    if (detail) out.push({ id: sig.id, title: sig.title, detail });
  }
  return out;
}
