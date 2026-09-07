import fs from "fs";
import { settingsPath } from "./paths";
import { DEFAULT_SYSTEM_INSTRUCTION } from "../prompt/system";
import { writeFileAtomic } from "../util/atomic-write";

// Reachable connections. There are no direct Anthropic or OpenAI slots: the
// same models are reached through OpenRouter on one key, at one bill.
// `claudeCode` bills against the user's Claude subscription via their local
// CLI and needs no key at all.
export type LlmProvider = "gemini" | "openrouter" | "ollama" | "claudeCode";
/** Runtime companion to the union above — a hand-edited settings file can
 *  carry any string, and an unrecognised provider must be dropped rather than
 *  reaching getAdapter and silently resolving to Gemini. */
export const LLM_PROVIDERS: LlmProvider[] = ["gemini", "openrouter", "ollama", "claudeCode"];
export type LlmTier = "pro" | "flash";

// Per-category guardrail toggles. ALL DEFAULT FALSE on a fresh install so the
// bot recounts source material faithfully out of the box. Mapping by provider:
//   - Gemini: turning a category ON flips that category's threshold from
//     BLOCK_NONE to BLOCK_MEDIUM_AND_ABOVE in the safetySettings array.
//   - Anthropic / OpenAI: their Messages / Chat-Completions APIs DO NOT expose
//     per-category safety. The only lever is the system prompt. When a
//     category is ON, an instruction line is appended asking the model to
//     apply its built-in safety guidance to that category.
export interface GuardrailFlags {
  harassment: boolean;
  hate: boolean;
  sexual: boolean;
  dangerous: boolean;
}

/** Per-surface routing. `provider`/`model` undefined means "follow the global
 *  setting" — that is what lets the chat surfaces answer on a Claude Code
 *  subscription while the dashboard keeps using whatever is selected. */
export interface SurfaceConfig {
  enabled: boolean;
  provider?: LlmProvider;
  model?: string;
}

/** Foundry's extra field. `allowPlayers` is a HARD CEILING, deliberately not a
 *  copy of the module's three-way access mode — the mode lives in Foundry,
 *  world-scoped, where the authoritative asker identity is. Two copies of one
 *  tri-state is the classic "why isn't my setting working" trap; a boolean
 *  asks a different question: may this install answer players at all. */
export interface FoundrySurfaceConfig extends SurfaceConfig {
  allowPlayers: boolean;
}

export interface Surfaces {
  discord: SurfaceConfig;
  foundry: FoundrySurfaceConfig;
  mcp: SurfaceConfig;
}

export interface Settings {
  systemInstruction: string;
  // The bot's in-character name (also used in the system prompt). Persists
  // until the user changes it from the dashboard. Defaults to "Tusk".
  botName: string;
  // Speculative mode: when on, the bot may answer hypothetical questions
  // (e.g. "who would order a glass of milk at Starbucks?") by reasoning about
  // characters' established personalities, tagged with [speculation].
  speculativeMode: boolean;
  // Per-category content guardrails. All-off default = today's behaviour
  // (Gemini BLOCK_NONE, no prompt-level refusal nudge). Toggled on via the
  // Home tab → Guardrails card.
  guardrails: GuardrailFlags;
  // Where the bot answers. Independent of botPaused: pause means "answer
  // nothing right now", these mean "this route exists at all".
  surfaces: Surfaces;
  // Bot-paused kill switch. When true, every surface ignores every
  // mention/DM silently — no typing indicator, no reply, no LLM call. The
  // bot stays connected to Discord (token + intents unchanged) so the
  // dashboard's pause toggle can flip it back instantly. Default false.
  botPaused: boolean;
  // When true (default), the citation markers the model emits per Rule 1
  // (`[filename]`, `[clarification: ID]`, `[D&D 5e]`, `[speculation]`,
  // `[sanitised per active guardrails]`) reach the user verbatim. When
  // false, they're stripped from the response in src/server/prompt/
  // strip-references.ts before the text is sent to Discord. The model
  // still receives the citation rule in its prompt — stripping is purely
  // a presentation choice that preserves grounding discipline.
  includeReferences: boolean;
  // Stage 2 fields. Defaulted on read so Stage 1 settings.json files keep working.
  provider: LlmProvider;
  proModel: string;
  flashModel: string;
  defaultTier: LlmTier;
  ollamaBaseUrl: string;
  /**
   * OpenRouter model ids the user has explicitly accepted data-sharing
   * routing for.
   *
   * Vault pins a privacy floor on every OpenRouter request (`zdr`,
   * `data_collection: deny`), which is why most `:free` variants are
   * unreachable — they are free *because* the host keeps prompts, often to
   * train on. Reaching one means giving that up, and the consent is recorded
   * per MODEL rather than as a global flag: a flag is something a user turns
   * on once to try a free model and forgets, after which every later
   * question ships their campaign to whichever host was cheapest. Listed by
   * model, the consent is attached to the thing it was given for and lapses
   * the moment they pick something else.
   */
  openRouterDataSharingOptIn: string[];
  // Semantic clarification retrieval (Stage 3). Higher threshold = stricter
  // match; lower = more permissive. topK = max clarifications injected per query.
  clarificationTopK: number;
  clarificationThreshold: number;
  // Optional override for the companion Tusk's Tomes integration. Empty/unset
  // means "auto-detect" — Vault scans a handful of conventional adjacent
  // paths (../Tusks-Tomes/Sessions, etc.).
  tomesSessionsPath?: string;
  // Where lore comes from.
  //   "folder"   (default): the resolved Tusks-Lore/ directory, as before.
  //   "obsidian":           an Obsidian vault at obsidianVaultPath, read
  //                         strictly read-only.
  // The two are alternatives, not a merge: a question answered from two
  // differently-organised corpora produces citations the user cannot trace
  // back to one place.
  loreSource: "folder" | "obsidian";
  /** Absolute path to the Obsidian vault. Only meaningful when
   *  loreSource is "obsidian". */
  obsidianVaultPath?: string;
  // When true (default), an Obsidian vault is read through its map: every
  // note's one-line digest in the prompt, and only the notes relevant to the
  // question reproduced in full. Turning it off concatenates the whole vault,
  // which is right for a small vault and stops scaling around a few hundred
  // notes. Ignored unless loreSource is "obsidian".
  useVaultMap: boolean;
  // Optional override for where lore documents live on disk. Empty/unset
  // means "auto-detect" — Vault probes for a `../Tusks-Lore/` sibling
  // first, then falls back to repo-local `Lore/`. Resolution happens once
  // at server boot — changing this requires a restart to take effect.
  // See src/server/config/paths.ts.
  loreFolderPath?: string;
  // Which upstream ref the in-app updater follows.
  //   "main" (default): mirror current behaviour — pull origin/main and
  //     advance HEAD on every push the maintainer lands.
  //   "tag":           refuse to advance until the maintainer publishes a
  //     release tag matching /^v\d+\.\d+\.\d+$/. Safer: a compromised PR that
  //     lands on main can't ship to users until it's explicitly tagged.
  //     (Signed-tag verification with GPG is a future enhancement — today
  //     "tag" only forces the deliberate-tag step, not signature checks.)
  // No UI toggle yet; the maintainer or advanced user flips this by hand in
  // settings.json. Default "main" keeps current installs unchanged.
  updaterTrack?: "main" | "tag";
  // Which git remote the in-app updater pulls from.
  //   "origin" (default): pull from `origin` — the public Tusks-Vault repo
  //     on a user install; whatever you set origin to on the maintainer's
  //     working clone.
  //   "dev":              pull from a remote literally named `dev`,
  //     conventionally pointed at the private Tusks-Vault-Dev mirror.
  //     The maintainer runs `git remote add dev https://github.com/...`
  //     before flipping this. The toggle is exposed in the dashboard
  //     behind a 5-tap unlock.
  //
  // Note: this is UX only. The real gate is GitHub auth — a user without
  // a Personal Access Token that has read access to Tusks-Vault-Dev gets a
  // 404 from git pull even if they flip the toggle. The PAT is collected
  // at runtime via /api/updater/dev-credential and held in memory only
  // (wiped on server restart). See src/server/util/dev-credential.ts.
  updaterRemote?: "origin" | "dev";
  // Legacy field retained for back-compat. Stage 1 reads from here; Stage 2
  // migrates it into proModel/flashModel and drops the field on next save.
  modelName?: string;
}

const GUARDRAILS_DEFAULT: GuardrailFlags = {
  harassment: false,
  hate: false,
  sexual: false,
  dangerous: false,
};

// Kept in sync with routes/settings.ts's write-path guard. Both must reject a
// path, query or fragment: the Ollama adapter builds `${base}/api/tags`, and a
// stored `#` turns that suffix into a fragment the server never sends.
export const LOOPBACK_BASE_URL_RE =
  /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/i;

const STAGE2_DEFAULTS: Omit<Settings, "systemInstruction" | "modelName"> = {
  provider: "gemini",
  proModel: "gemini-2.5-pro",
  flashModel: "gemini-3-flash-preview",
  defaultTier: "flash",
  ollamaBaseUrl: "http://localhost:11434",
  openRouterDataSharingOptIn: [],
  clarificationTopK: 5,
  // 0.40 chosen empirically against question+answer indexing with
  // all-MiniLM-L6-v2: catches answer-side paraphrases like "tell me about
  // <name>" (0.42) and "<concept> stronghold" (0.49) while keeping unrelated
  // off-corpus queries below threshold in test data. The LLM downstream is
  // told to ignore irrelevant clarifications, so an occasional weak match
  // does no harm. Raise to 0.55+ for stricter recall; lower to 0.30 for
  // permissive matching.
  clarificationThreshold: 0.40,
  botName: "Tusk",
  speculativeMode: false,
  surfaces: {
    // Discord defaults ON — see applySurfaceDefaults for why an upgrade must
    // not silently switch a working bot off.
    discord: { enabled: true },
    foundry: { enabled: false, allowPlayers: false },
    mcp: { enabled: false },
  },
  guardrails: GUARDRAILS_DEFAULT,
  // Default true preserves Stage 3's behaviour: existing installs that have
  // never seen this field continue to render citations exactly as before.
  includeReferences: true,
  // Folder source by default: it is what every existing install already
  // uses, and pointing at an Obsidian vault is a deliberate choice.
  loreSource: "folder",
  useVaultMap: true,
  // Default false = bot is responding. Toggled from the prominent Home-tab
  // pause card. When true, the Discord handler short-circuits before any
  // side effects — no typing indicator, no reply, no LLM call. The bot
  // stays connected to Discord (so flipping back is instant) and Discord's
  // own presence indicator continues to show it as online.
  botPaused: false,
};

// Validate / coerce a raw guardrails object from the on-disk settings file.
// Any missing field defaults to false; non-boolean values are rejected so a
// hand-edited settings.json can't accidentally crash the adapter pipeline.
function applyGuardrailDefaults(raw: unknown): GuardrailFlags {
  if (!raw || typeof raw !== "object") return { ...GUARDRAILS_DEFAULT };
  const r = raw as Record<string, unknown>;
  return {
    harassment: typeof r.harassment === "boolean" ? r.harassment : false,
    hate: typeof r.hate === "boolean" ? r.hate : false,
    sexual: typeof r.sexual === "boolean" ? r.sexual : false,
    dangerous: typeof r.dangerous === "boolean" ? r.dangerous : false,
  };
}

/** Coerce one surface's config from a hand-edited or older settings file. */
function applySurfaceConfig(raw: unknown, fallback: SurfaceConfig): SurfaceConfig {
  if (!raw || typeof raw !== "object") return { ...fallback };
  const r = raw as Record<string, unknown>;
  return {
    enabled: typeof r.enabled === "boolean" ? r.enabled : fallback.enabled,
    // A provider outside the union would reach getAdapter as an unrecognised
    // string and silently fall through to Gemini. Drop it instead.
    provider: LLM_PROVIDERS.includes(r.provider as LlmProvider) ? (r.provider as LlmProvider) : undefined,
    model: typeof r.model === "string" && r.model.trim() ? r.model.trim() : undefined,
  };
}

/**
 * Surfaces block, defaulted.
 *
 * The migration that matters: before surfaces existed, Discord was implicitly
 * on whenever a token was configured. A settings file with no `surfaces` key
 * is one of those, so Discord MUST default to enabled — otherwise upgrading
 * silently switches a working bot off and the user's table goes quiet with no
 * message explaining why. Foundry and MCP are new, so they default off.
 */
function applySurfaceDefaults(raw: unknown): Surfaces {
  const d = STAGE2_DEFAULTS.surfaces;
  if (!raw || typeof raw !== "object") return JSON.parse(JSON.stringify(d)) as Surfaces;
  const r = raw as Record<string, unknown>;
  const foundry = applySurfaceConfig(r.foundry, d.foundry);
  return {
    discord: applySurfaceConfig(r.discord, d.discord),
    foundry: {
      ...foundry,
      allowPlayers:
        typeof (r.foundry as Record<string, unknown>)?.allowPlayers === "boolean"
          ? ((r.foundry as Record<string, unknown>).allowPlayers as boolean)
          : d.foundry.allowPlayers,
    },
    mcp: applySurfaceConfig(r.mcp, d.mcp),
  };
}

function applyDefaults(raw: Partial<Settings>): Settings {
  const settings: Settings = {
    systemInstruction: raw.systemInstruction?.trim() ? raw.systemInstruction : DEFAULT_SYSTEM_INSTRUCTION,
    provider: raw.provider ?? STAGE2_DEFAULTS.provider,
    proModel: raw.proModel ?? STAGE2_DEFAULTS.proModel,
    flashModel: raw.flashModel ?? raw.modelName ?? STAGE2_DEFAULTS.flashModel,
    // Anything that is not an array of strings reads as no consent given.
    // A malformed value must never widen what a request is allowed to share.
    openRouterDataSharingOptIn: Array.isArray(raw.openRouterDataSharingOptIn)
      ? raw.openRouterDataSharingOptIn.filter((m: unknown): m is string => typeof m === "string" && m.length > 0)
      : [],
    defaultTier: raw.defaultTier ?? STAGE2_DEFAULTS.defaultTier,
    // Re-coerced on read, like loreSource and updaterRemote below. The POST
    // handler validates this, but settings.json is a file on disk a user can
    // edit by hand — and this value becomes the host of a server-side fetch,
    // so the write-path check alone is not the boundary.
    ollamaBaseUrl: LOOPBACK_BASE_URL_RE.test(String(raw.ollamaBaseUrl ?? ""))
      ? raw.ollamaBaseUrl!
      : STAGE2_DEFAULTS.ollamaBaseUrl,
    clarificationTopK: raw.clarificationTopK ?? STAGE2_DEFAULTS.clarificationTopK,
    clarificationThreshold: raw.clarificationThreshold ?? STAGE2_DEFAULTS.clarificationThreshold,
    botName: (raw.botName?.trim() || STAGE2_DEFAULTS.botName) as string,
    speculativeMode: raw.speculativeMode ?? STAGE2_DEFAULTS.speculativeMode,
    surfaces: applySurfaceDefaults(raw.surfaces),
    guardrails: applyGuardrailDefaults(raw.guardrails),
    includeReferences: raw.includeReferences ?? STAGE2_DEFAULTS.includeReferences,
    botPaused: raw.botPaused ?? STAGE2_DEFAULTS.botPaused,
    tomesSessionsPath: raw.tomesSessionsPath,
    loreFolderPath: raw.loreFolderPath,
    // Any value other than the literal "obsidian" reads as the folder source.
    // A hand-edited settings.json with a typo should fall back to what every
    // install already had, not to an unreadable half-state.
    loreSource: raw.loreSource === "obsidian" ? "obsidian" : "folder",
    obsidianVaultPath: raw.obsidianVaultPath,
    useVaultMap: raw.useVaultMap ?? STAGE2_DEFAULTS.useVaultMap,
    updaterTrack: raw.updaterTrack === "tag" ? "tag" : "main",
    updaterRemote: raw.updaterRemote === "dev" ? "dev" : "origin",
    modelName: raw.modelName,
  };

  // NOTE: model ids are deliberately NOT reconciled against `provider` here.
  //
  // `settings.provider` is not the last word on which provider is in use — an
  // active key outranks it (see llm/registry.ts getAdapter), and the two can
  // legitimately disagree, because activating a key does not always rewrite
  // this field. Reconciling here would read the losing side and "repair"
  // model ids that were correct for the adapter actually being called.
  // llm/registry.ts does it instead, where the winning provider is known.
  return settings;
}

/**
 * Recover from a settings file that will not parse.
 *
 * Falling back to defaults and moving on — which is what this used to do —
 * leaves the broken file in place, so every subsequent read fails the same
 * way, logs the same error, and silently ignores every setting the user has
 * ever chosen. On one boot that is four identical stack traces and a bot
 * quietly running on defaults.
 *
 * So: move the unreadable file aside and write a clean one. The copy is kept
 * rather than deleted — it may hold a lore path or a system prompt the user
 * would rather retype from than lose, and it costs a few kilobytes.
 */
function quarantineUnreadableSettings(err: unknown): void {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const target = settingsPath();
  const backup = `${target}.corrupt-${stamp}`;
  try {
    fs.renameSync(target, backup);
    console.error(
      `[settings] ${target} could not be parsed (${(err as Error).message}). ` +
        `Moved it to ${backup} and started from defaults — open it if you want to copy anything back.`
    );
  } catch (renameErr) {
    // Could not even move it. Say so plainly rather than pretending to
    // recover; the next read will hit the same file and report again.
    console.error(
      `[settings] ${target} is unreadable and could not be moved aside ` +
        `(${(renameErr as Error).message}). Running on defaults.`
    );
  }
}

export function getSettings(): Settings {
  const target = settingsPath();
  if (!fs.existsSync(target)) return applyDefaults({});

  let raw: Partial<Settings>;
  try {
    raw = JSON.parse(fs.readFileSync(target, "utf-8")) as Partial<Settings>;
  } catch (err) {
    quarantineUnreadableSettings(err);
    const fresh = applyDefaults({});
    try {
      saveSettings(fresh);
    } catch {
      /* disk is unwritable; the in-memory defaults still work */
    }
    return fresh;
  }

  const settings = applyDefaults(raw);
  // Persist defaults the first time we see an old file.
  try {
    saveSettings(settings);
  } catch (err) {
    // A read must not fail because the write-back failed — the settings we
    // just computed are correct either way.
    console.error("[settings] could not persist defaults:", (err as Error).message);
  }
  return settings;
}

export function saveSettings(settings: Settings): void {
  // Atomic, and atomic against a second PROCESS — see util/atomic-write.ts.
  // This file in particular is written on every getSettings() call, so the
  // dev server and any script that reads settings are permanently racing.
  writeFileAtomic(settingsPath(), JSON.stringify(settings, null, 2));
}
