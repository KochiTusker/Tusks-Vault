import { useEffect, useRef, useState } from "react";
import { Coffee } from "lucide-react";
import { Header } from "./components/Header";
import { Astrolabe } from "./components/Astrolabe";
import { FaqPage } from "./components/FaqPage";
import { BeginnerGuidePage } from "./components/BeginnerGuidePage";
import { AboutPage } from "./components/AboutPage";
import { DocsViewer } from "./components/DocsViewer";
import { Tabs, TabsList, TabsTrigger } from "./components/ui/Tabs";
import { usePersonas } from "./hooks/usePersonas";
import { PersonasPanel } from "./components/panels/PersonasPanel";
import { KeyVaultPanel } from "./components/panels/KeyVaultPanel";
import { FirstRunBanner } from "./components/panels/FirstRunBanner";
import { BotPauseCard } from "./components/panels/BotPauseCard";
import { StatStrip } from "./components/panels/StatStrip";
import { ActiveProviderPanel, type AvailableModel, type ProviderSlot } from "./components/panels/ActiveProviderPanel";
import { GuardrailsPanel, type GuardrailFlags } from "./components/panels/GuardrailsPanel";
import { CampaignPanel, type CampaignTab, type Clarification, type LoreGap } from "./components/panels/CampaignPanel";
import { LorePanel, type KnowledgeFile, type TomesChronicle, type TomesProbe, type TusksLoreProbe } from "./components/panels/LorePanel";
import { ObsidianVaultPanel, type VaultStatus } from "./components/panels/ObsidianVaultPanel";
import { SettingsPanel } from "./components/panels/SettingsPanel";
import { SurfacesPanel } from "./components/panels/SurfacesPanel";
import { OpenRouterBrowser } from "./components/panels/OpenRouterBrowser";
import { DiscordSetupModal } from "./components/panels/DiscordSetupModal";
import { OllamaInfoModal } from "./components/panels/OllamaInfoModal";
import { transitionOrJustDo } from "./lib/viewTransition";
import {
  KEY_SECTIONS,
  type LlmProvider,
  type LlmTier,
  type KeyTier,
  type StoredKey,
  type TestResult,
} from "./types/keys";
void KEY_SECTIONS;

// Four top-level views: the work surfaces left, Settings and Help right —
// where every application people already know keeps them. The old
// Beginner's Guide / FAQ / About tabs are pages INSIDE Help now: they are
// documentation, and seven top-level tabs made the four that matter harder
// to find.
export type View = "home" | "lore" | "settings" | "help";
type HelpPage = "docs" | "beginner" | "faq" | "about";

// Pricing hints displayed next to model dropdown options. Substring matching
// on Gemini's stable naming convention gives useful signal — flash/lite is
// cheap, pro/ultra is premium.
function modelCostHint(provider: LlmProvider, modelId: string): string {
  const id = modelId.toLowerCase();
  if (provider === "gemini") {
    if (id.includes("flash-lite") || id.includes("nano")) return "💰 cheapest";
    if (id.includes("flash") || id.includes("lite")) return "💰 cheap";
    if (id.includes("pro") || id.includes("ultra")) return "💎 premium";
    return "";
  }
  if (provider === "claudeCode") {
    // Billed against the user's Claude subscription, not per token — the
    // scarce resource is the usage window, so that is what we hint at.
    if (id.includes("haiku")) return "⚡ light on quota";
    if (id.includes("opus")) return "🕯 heavy on quota";
    return "included in your plan";
  }
  if (provider === "ollama") return "🖥 local, free";
  // OpenRouter spans ~400 models from every lab — substring guessing would
  // mislead more than it helps; real prices come from the live catalogue.
  return "";
}

const BMC_URL = "https://buymeacoffee.com/kochitusker";

const PROVIDER_LABEL: Record<LlmProvider, string> = {
  gemini: "Google Gemini",
  openrouter: "OpenRouter",
  claudeCode: "Claude Code (subscription)",
  ollama: "Ollama (local)",
};

interface BotStatus {
  status: string;
  botName: string;
  guilds: number;
}

interface ProviderStatusEntry {
  id: LlmProvider;
  label: string;
  envVar: string;
  keyConfigured: boolean;
  isCurrent: boolean;
}

const PROVIDER_DEFAULTS: Record<LlmProvider, { pro: string; flash: string }> = {
  gemini: { pro: "gemini-2.5-pro", flash: "gemini-3-flash-preview" },
  // Broadly available with zero-retention hosts, and priced sanely for a
  // 500KB-KB prompt. Any catalogue model can be picked instead.
  openrouter: { pro: "google/gemini-2.5-pro", flash: "google/gemini-2.5-flash" },
  claudeCode: { pro: "opus", flash: "haiku" },
  ollama: { pro: "llama3.1:8b", flash: "phi3:mini" },
};

// Active-provider slot definitions for the Home tab picker. A "key" slot's
// id is the {provider, tier} pair the API Keys panel groups by; a "keyless"
// slot's id is just the provider, because there is no key to disambiguate.
const PROVIDER_SLOTS: ProviderSlot[] = [
  { id: "openrouter:n/a", kind: "key", provider: "openrouter", tier: "n/a", label: "OpenRouter", hint: "One key, ~400 models from every lab — Claude and GPT included. Routes only to hosts that do not retain prompts." },
  { id: "gemini:paid", kind: "key", provider: "gemini", tier: "paid", label: "Google Gemini — Paid", hint: "Billing-enabled. Pro / Flash / Flash-Lite all reachable." },
  { id: "gemini:free", kind: "key", provider: "gemini", tier: "free", label: "Google Gemini — Free", hint: "No-billing project. Paid-only models are hidden." },
  { id: "claudeCode", kind: "keyless", provider: "claudeCode", label: "Claude Code (subscription)", hint: "Runs through your signed-in Claude Code CLI. No API key and no per-token bill — it draws on your plan's usage window." },
  { id: "ollama", kind: "keyless", provider: "ollama", label: "Ollama (local)", hint: "Local inference. Nothing leaves the machine." },
];

export default function App() {
  const [status, setStatus] = useState<BotStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [knowledgeFiles, setKnowledgeFiles] = useState<KnowledgeFile[]>([]);
  const [clarifications, setClarifications] = useState<Clarification[]>([]);
  const [loreGaps, setLoreGaps] = useState<LoreGap[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<CampaignTab>("clarifications");
  const [view, setViewRaw] = useState<View>("home");
  const [helpPage, setHelpPage] = useState<HelpPage>("docs");
  const [systemInstruction, setSystemInstruction] = useState("");
  const [provider, setProvider] = useState<LlmProvider>("gemini");
  const [proModel, setProModel] = useState(PROVIDER_DEFAULTS.gemini.pro);
  const [flashModel, setFlashModel] = useState(PROVIDER_DEFAULTS.gemini.flash);
  const [defaultTier, setDefaultTier] = useState<LlmTier>("flash");
  const [ollamaBaseUrl, setOllamaBaseUrl] = useState("http://localhost:11434");
  const [clarificationTopK, setClarificationTopK] = useState(5);
  const [clarificationThreshold, setClarificationThreshold] = useState(0.4);
  const [botName, setBotName] = useState("Tusk");
  const [speculativeMode, setSpeculativeMode] = useState(false);
  const [includeReferences, setIncludeReferences] = useState(true);
  const [botPaused, setBotPaused] = useState(false);
  const [togglingBotPaused, setTogglingBotPaused] = useState(false);
  const [togglingIncludeReferences, setTogglingIncludeReferences] = useState(false);
  const [togglingSpeculativeMode, setTogglingSpeculativeMode] = useState(false);
  // Set when a save did NOT stick. The toggle used to live only inside the
  // bulk Save button, so the UI could show Speculative Mode on while the
  // server held false indefinitely — and the bot then answered every
  // judgement question with the lore-gap phrase for reasons nothing surfaced.
  const [speculativeError, setSpeculativeError] = useState<string | null>(null);
  const [guardrails, setGuardrails] = useState<GuardrailFlags>({
    harassment: false,
    hate: false,
    sexual: false,
    dangerous: false,
  });
  const [savingGuardrails, setSavingGuardrails] = useState(false);
  const [tomesSessionsPath, setTomesSessionsPath] = useState("");
  const [tomesProbe, setTomesProbe] = useState<TomesProbe | null>(null);
  const [tusksLore, setTusksLore] = useState<TusksLoreProbe | null>(null);
  const [tomesChronicles, setTomesChronicles] = useState<TomesChronicle[]>([]);
  const [availableModels, setAvailableModels] = useState<AvailableModel[]>([]);
  // Probe state. Deliberately separate from the model list: the list is free
  // to fetch, the probe spends a token per model, so it never runs implicitly.
  const [probeSlot, setProbeSlot] = useState<string | null>(null);
  const [probedAt, setProbedAt] = useState<string | null>(null);
  const [probing, setProbing] = useState(false);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsReason, setModelsReason] = useState<string | null>(null);
  const [providerStatuses, setProviderStatuses] = useState<ProviderStatusEntry[]>([]);
  // Which lore source is live. Owned here because both the source picker and
  // the Lore tab's provenance lines read it.
  const [vaultStatus, setVaultStatus] = useState<VaultStatus | null>(null);
  const [keys, setKeys] = useState<StoredKey[]>([]);
  const [activeKey, setActiveKey] = useState<StoredKey | null>(null);
  const [showOllamaInfo, setShowOllamaInfo] = useState(false);
  const [showDiscordSetup, setShowDiscordSetup] = useState(false);
  const [discordConfigured, setDiscordConfigured] = useState(false);
  const [discordMaskedToken, setDiscordMaskedToken] = useState<string | null>(null);
  const [discordAppId, setDiscordAppId] = useState<string>("");
  const [discordInviteUrl, setDiscordInviteUrl] = useState<string | null>(null);
  // Per-slot inline add-key form (KeyVaultPanel). Slot keys look like
  // `gemini:paid`, `anthropic:n/a` — each provider sub-section has its own
  // expand-to-add form rather than one global modal.
  const [addKeyFor, setAddKeyFor] = useState<string | null>(null);
  const [newKeyProvider, setNewKeyProvider] = useState<LlmProvider>("gemini");
  const [newKeyLabel, setNewKeyLabel] = useState("");
  const [newKeyTier, setNewKeyTier] = useState<KeyTier>("free");
  const [newKeyValue, setNewKeyValue] = useState("");
  const [savingKey, setSavingKey] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [keyTestResults, setKeyTestResults] = useState<Record<string, TestResult>>({});

  // Persona state, owned by a dedicated hook. Personas ship with the app,
  // so there is no install state to consult before fetching them.
  const personasApi = usePersonas();
  const { personas, activePersonaId, busy: personaBusy, fetchPersonas, setActiveOnServer: setActivePersonaServer } = personasApi;

  // Hidden 5-tap on the header logo reveals the dev-mode updater toggle.
  // Session-local; the persisted updaterRemote setting is unaffected.
  const [devModeUnlocked, setDevModeUnlocked] = useState(false);
  const devTapCountRef = useRef(0);
  const devTapTimerRef = useRef<number | null>(null);
  const handleSecretTap = () => {
    if (devTapTimerRef.current !== null) window.clearTimeout(devTapTimerRef.current);
    devTapCountRef.current += 1;
    if (devTapCountRef.current >= 5) {
      setDevModeUnlocked(prev => !prev);
      devTapCountRef.current = 0;
    } else {
      devTapTimerRef.current = window.setTimeout(() => {
        devTapCountRef.current = 0;
      }, 2000);
    }
  };

  // Tab switches cross-fade where the platform supports it. The update
  // always runs; only the animation is conditional (and skipped for
  // reduced-motion users).
  const setView = (v: View) => {
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    transitionOrJustDo(() => setViewRaw(v), document as never, reduced);
  };

  // ── Fetchers ─────────────────────────────────────────────────────────

  const fetchStatus = async () => {
    try {
      const res = await fetch("/api/status");
      setStatus(await res.json());
    } catch (err) {
      console.error("Failed to fetch status", err);
    } finally {
      setLoading(false);
    }
  };

  const fetchKnowledge = async () => {
    try {
      const res = await fetch("/api/knowledge");
      setKnowledgeFiles(await res.json());
    } catch (err) {
      console.error("Failed to fetch knowledge base", err);
    }
  };

  const fetchClarifications = async () => {
    try {
      const res = await fetch("/api/clarifications");
      setClarifications(await res.json());
    } catch (err) {
      console.error("Failed to fetch clarifications", err);
    }
  };

  const fetchLoreGaps = async () => {
    try {
      const res = await fetch("/api/lore-gaps");
      setLoreGaps(await res.json());
    } catch (err) {
      console.error("Failed to fetch lore gaps", err);
    }
  };

  const fetchSettings = async () => {
    try {
      const res = await fetch("/api/settings");
      const data = await res.json();
      setSystemInstruction(data.systemInstruction);
      if (data.provider) setProvider(data.provider);
      if (data.proModel) setProModel(data.proModel);
      if (data.flashModel) setFlashModel(data.flashModel);
      if (data.defaultTier) setDefaultTier(data.defaultTier);
      if (data.ollamaBaseUrl) setOllamaBaseUrl(data.ollamaBaseUrl);
      if (data.clarificationTopK !== undefined) setClarificationTopK(data.clarificationTopK);
      if (data.clarificationThreshold !== undefined) setClarificationThreshold(data.clarificationThreshold);
      if (data.botName) setBotName(data.botName);
      if (data.speculativeMode !== undefined) setSpeculativeMode(data.speculativeMode);
      if (data.includeReferences !== undefined) setIncludeReferences(data.includeReferences);
      if (data.botPaused !== undefined) setBotPaused(data.botPaused);
      if (data.guardrails && typeof data.guardrails === "object") {
        setGuardrails({
          harassment: !!data.guardrails.harassment,
          hate: !!data.guardrails.hate,
          sexual: !!data.guardrails.sexual,
          dangerous: !!data.guardrails.dangerous,
        });
      }
      if (data.tomesSessionsPath !== undefined) setTomesSessionsPath(data.tomesSessionsPath || "");
    } catch (err) {
      console.error("Failed to fetch settings", err);
    }
  };

  const fetchVaultStatus = async () => {
    try {
      const res = await fetch("/api/obsidian/status");
      if (res.ok) setVaultStatus((await res.json()) as VaultStatus);
    } catch {
      /* transient; the next poll or action refetches */
    }
  };

  const fetchProviders = async () => {
    try {
      const res = await fetch("/api/providers");
      setProviderStatuses(await res.json());
    } catch (err) {
      console.error("Failed to fetch providers", err);
    }
  };

  const fetchKeys = async () => {
    try {
      const res = await fetch("/api/keys");
      const data = await res.json();
      setKeys(data.keys || []);
      setActiveKey(data.active || null);
    } catch (err) {
      console.error("Failed to fetch keys", err);
    }
  };

  const fetchTomesStatus = async () => {
    try {
      const res = await fetch("/api/integrations/tomes");
      const data = await res.json();
      setTomesProbe(data.probe);
      setTomesChronicles(data.chronicles || []);
    } catch (err) {
      console.error("Failed to probe Tusk's Tomes", err);
      setTomesProbe(null);
    }
  };

  const fetchTusksLore = async () => {
    try {
      const res = await fetch("/api/integrations/tusks-lore");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setTusksLore(await res.json());
    } catch (err) {
      console.error("Failed to probe Tusks-Lore", err);
      setTusksLore(null);
    }
  };

  const fetchAvailableModels = async () => {
    setModelsLoading(true);
    try {
      const res = await fetch("/api/models");
      const data = await res.json();
      if (data.available) {
        setAvailableModels(data.models || []);
        setModelsReason(null);
        setProbeSlot(data.probeSlot ?? null);
        setProbedAt(data.probedAt ?? null);
      } else {
        setAvailableModels([]);
        setModelsReason(data.reason || null);
        setProbeSlot(null);
        setProbedAt(null);
      }
    } catch (err) {
      console.error("Failed to fetch model list", err);
      setAvailableModels([]);
      setModelsReason("Could not reach the model list endpoint.");
    } finally {
      setModelsLoading(false);
    }
  };

  // One real call per model, so the user asks for it explicitly. Refetching
  // the list afterwards is what carries the verdicts back into the dropdown.
  const probeModels = async () => {
    if (!probeSlot) return;
    setProbing(true);
    try {
      const res = await fetch("/api/models/probe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slot: probeSlot }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setModelsReason(data.error ?? "The test could not be run.");
        return;
      }
      await fetchAvailableModels();
    } catch (err) {
      console.error("Model probe failed", err);
    } finally {
      setProbing(false);
    }
  };

  const fetchDiscord = async () => {
    try {
      const res = await fetch("/api/discord");
      const data = await res.json();
      setDiscordConfigured(!!data.tokenConfigured);
      setDiscordMaskedToken(data.maskedToken || null);
      setDiscordAppId(data.appId || "");
      setDiscordInviteUrl(data.inviteUrl || null);
    } catch (err) {
      console.error("Failed to fetch discord status", err);
    }
  };

  const fetchLogs = async () => {
    try {
      const res = await fetch("/api/logs");
      setLogs(await res.json());
    } catch (err) {
      console.error("Failed to fetch logs", err);
    }
  };

  useEffect(() => {
    fetchStatus();
    fetchKnowledge();
    fetchClarifications();
    fetchLoreGaps();
    fetchSettings();
    fetchProviders();
    fetchVaultStatus();
    fetchKeys();
    fetchDiscord();
    fetchAvailableModels();
    fetchTomesStatus();
    fetchTusksLore();
    fetchLogs();
    fetchPersonas();
    const interval = setInterval(() => {
      fetchStatus();
      fetchLoreGaps();
      if (activeTab === "logs") fetchLogs();
    }, 5000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // Answer-reactive chrome: while the bot is composing a Discord reply the
  // status endpoint reports generating=true, and the whole room responds —
  // sparks quicken, a breath glows along the working area's top edge.
  useEffect(() => {
    const generating = !!(status as { generating?: boolean } | null)?.generating;
    document.documentElement.dataset.thinking = String(generating);
  }, [status]);

  // ── Actions ──────────────────────────────────────────────────────────

  const submitNewKey = async () => {
    if (!newKeyValue.trim()) return;
    setSavingKey(true);
    try {
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: newKeyProvider,
          label: newKeyLabel || `${PROVIDER_LABEL[newKeyProvider]} key`,
          // Gemini is the only provider whose free and paid projects bill
          // separately, so it is the only one carrying a tier.
          tier: newKeyProvider === "gemini" ? newKeyTier : "n/a",
          key: newKeyValue,
        }),
      });
      if (res.ok) {
        setNewKeyLabel("");
        setNewKeyValue("");
        setAddKeyFor(null);
        await fetchKeys();
        await fetchProviders();
      }
    } catch (err) {
      console.error("Failed to add key", err);
    } finally {
      setSavingKey(false);
    }
  };

  const deleteStoredKey = async (id: string) => {
    try {
      await fetch(`/api/keys/${id}`, { method: "DELETE" });
      await fetchKeys();
      await fetchProviders();
    } catch (err) {
      console.error("Failed to delete key", err);
    }
  };

  const testKey = async (id: string) => {
    setKeyTestResults(prev => ({ ...prev, [id]: { status: "pending" } }));
    try {
      const res = await fetch(`/api/keys/${id}/test`, { method: "POST" });
      const data = await res.json();
      if (data.ok) {
        setKeyTestResults(prev => ({ ...prev, [id]: { status: "ok", modelCount: data.modelCount } }));
      } else {
        setKeyTestResults(prev => ({ ...prev, [id]: { status: "fail", error: data.error || "Unknown error" } }));
      }
    } catch (err) {
      setKeyTestResults(prev => ({ ...prev, [id]: { status: "fail", error: (err as Error).message } }));
    }
  };

  const selectChannel = async (kind: "key" | "ollama" | "claudeCode", id?: string) => {
    try {
      const res = await fetch("/api/active-channel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(kind === "key" ? { kind, id } : { kind }),
      });
      if (res.ok) {
        await fetchKeys();
        await fetchSettings();
        await fetchProviders();
        await fetchAvailableModels();
      }
    } catch (err) {
      console.error("Failed to switch channel", err);
    }
  };

  const pickProviderSlot = (slotId: string) => {
    if (!slotId) return;
    const slot = PROVIDER_SLOTS.find(s => s.id === slotId);
    if (!slot) return;
    if (slot.kind === "keyless") return void selectChannel(slot.provider);
    const target = keys.find(k => k.provider === slot.provider && k.tier === slot.tier);
    if (target) void selectChannel("key", target.id);
  };

  // Picking a model saves it into both tier slots so any internal Pro/Flash
  // routing always lands on the chosen model, then persists immediately.
  const pickModel = async (id: string) => {
    if (!id) return;
    setProModel(id);
    setFlashModel(id);
    try {
      setSavingSettings(true);
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proModel: id, flashModel: id }),
      });
      if (res.ok) {
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 1800);
      }
    } catch (err) {
      console.error("Failed to save model selection", err);
    } finally {
      setSavingSettings(false);
    }
  };

  // Instant-save toggles: the user clicks once and expects the change to
  // take effect on the NEXT bot reply, not "after I also remember to click
  // Save Settings". Optimistic update, revert on failure.
  /**
   * Speculative Mode, saved the moment it is clicked.
   *
   * Confirms against the settings the server echoes back rather than trusting
   * a 200 — "the request succeeded" and "the flag is now on" are different
   * claims, and only the second one is what the user is being shown.
   */
  const toggleSpeculativeMode = async () => {
    if (togglingSpeculativeMode) return;
    setTogglingSpeculativeMode(true);
    setSpeculativeError(null);
    const next = !speculativeMode;
    setSpeculativeMode(next);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ speculativeMode: next }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const saved = data?.settings?.speculativeMode;
      if (typeof saved === "boolean") {
        // The server's value wins, always. If it disagrees the toggle snaps to
        // the truth rather than leaving the two out of step.
        setSpeculativeMode(saved);
        if (saved !== next) setSpeculativeError("The server did not accept that change.");
      }
    } catch (err) {
      setSpeculativeMode(!next);
      setSpeculativeError((err as Error).message || "Could not reach the server.");
      console.error("Failed to toggle speculativeMode", err);
    } finally {
      setTogglingSpeculativeMode(false);
    }
  };

  const toggleIncludeReferences = async () => {
    if (togglingIncludeReferences) return;
    setTogglingIncludeReferences(true);
    const next = !includeReferences;
    setIncludeReferences(next);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ includeReferences: next }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      setIncludeReferences(!next);
      console.error("Failed to toggle includeReferences", err);
    } finally {
      setTogglingIncludeReferences(false);
    }
  };

  const toggleBotPaused = async () => {
    if (togglingBotPaused) return;
    setTogglingBotPaused(true);
    const next = !botPaused;
    setBotPaused(next);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ botPaused: next }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      setBotPaused(!next);
      console.error("Failed to toggle bot pause", err);
    } finally {
      setTogglingBotPaused(false);
    }
  };

  const saveGuardrails = async (next: GuardrailFlags): Promise<boolean> => {
    setSavingGuardrails(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ guardrails: next }),
      });
      if (res.ok) {
        setGuardrails(next);
        return true;
      }
      return false;
    } catch (err) {
      console.error("Failed to save guardrails", err);
      return false;
    } finally {
      setSavingGuardrails(false);
    }
  };

  const saveSettings = async () => {
    setSavingSettings(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction,
          provider,
          proModel,
          flashModel,
          defaultTier,
          ollamaBaseUrl,
          clarificationTopK,
          clarificationThreshold,
          botName,
          speculativeMode,
          includeReferences,
          guardrails,
          tomesSessionsPath,
        }),
      });
      if (res.ok) {
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 3000);
        fetchProviders();
      }
    } catch (err) {
      console.error("Failed to save settings", err);
    } finally {
      setSavingSettings(false);
    }
  };

  const activePersona = personas.find(p => p.id === activePersonaId);

  // Keyless connections are offered iff the server says they are reachable:
  // Ollama answering on its base URL, the Claude Code CLI being on PATH.
  const keylessReachable: Record<string, boolean> = Object.fromEntries(
    providerStatuses.map(p => [p.id, p.keyConfigured])
  );

  const firstRunIncomplete =
    !loading && (keys.length === 0 || !discordConfigured || knowledgeFiles.length === 0);

  return (
    <div className="flex min-h-screen flex-col font-sans">
      {/* Ambient background — one instrument turning behind the page.
          Fixed, aria-hidden, pointer-transparent; see .astrolabe in
          index.css for why it replaced the hearth-and-embers stage. */}
      <Astrolabe />

      <Header onSecretTap={handleSecretTap} />

      <main className="tab-bg relative mx-auto w-full max-w-5xl flex-1 px-6 py-6" data-tab={view}>
        <Tabs value={view} onValueChange={v => setView(v as View)} className="space-y-4">
          <TabsList className="w-full">
            <TabsTrigger value="home">Home</TabsTrigger>
            <TabsTrigger value="lore">Lore</TabsTrigger>
            <TabsTrigger value="settings" className="ml-auto">
              Settings
            </TabsTrigger>
            <TabsTrigger value="help">Help</TabsTrigger>
          </TabsList>
        </Tabs>

        {view === "home" && (
          <>
            {firstRunIncomplete && (
              <FirstRunBanner
                keyCount={keys.length}
                discordConfigured={discordConfigured}
                knowledgeCount={knowledgeFiles.length}
                onAddKey={() => {
                  setView("settings");
                  setNewKeyProvider("gemini");
                  setNewKeyTier("paid");
                  setNewKeyLabel("");
                  setNewKeyValue("");
                  setAddKeyFor("gemini:paid");
                }}
                onOpenDiscord={() => setShowDiscordSetup(true)}
                onGoLore={() => setView("lore")}
              />
            )}

            <BotPauseCard
              botPaused={botPaused}
              toggling={togglingBotPaused}
              onToggle={toggleBotPaused}
              discordConfigured={discordConfigured}
            />

            <StatStrip
              loading={loading}
              statusText={status?.status}
              botName={status?.botName}
              discordConfigured={discordConfigured}
              activeKeyLabel={activeKey?.label ?? null}
              activeProviderLabel={activeKey ? PROVIDER_LABEL[activeKey.provider] : null}
              provider={provider}
              defaultTier={defaultTier}
              proModel={proModel}
              flashModel={flashModel}
              knowledgeCount={knowledgeFiles.length}
              gapCount={loreGaps.length}
              onOpenDiscord={() => setShowDiscordSetup(true)}
              onGoLore={() => setView("lore")}
              onGoGaps={() => setActiveTab("gaps")}
            />

            <ActiveProviderPanel
              slots={PROVIDER_SLOTS}
              keys={keys}
              activeKey={activeKey}
              provider={provider}
              proModel={proModel}
              availableModels={availableModels}
              modelsLoading={modelsLoading}
              modelsReason={modelsReason}
              probedAt={probedAt}
              probing={probing}
              onProbe={() => void probeModels()}
              keylessReachable={keylessReachable}
              personas={personas}
              activePersonaId={activePersonaId}
              personaBusy={personaBusy}
              savingSettings={savingSettings}
              saveSuccess={saveSuccess}
              modelCostHint={modelCostHint}
              onPickProvider={pickProviderSlot}
              onPickModel={id => void pickModel(id)}
              onPickPersona={id => void setActivePersonaServer(id)}
              onRetryModels={() => void fetchAvailableModels()}
              onGoSettings={() => setView("settings")}
              onShowOllamaInfo={() => setShowOllamaInfo(true)}
            />

            <SurfacesPanel />

            <GuardrailsPanel
              guardrails={guardrails}
              setGuardrails={setGuardrails}
              saving={savingGuardrails}
              onSave={saveGuardrails}
            />

            <CampaignPanel
              clarifications={clarifications}
              loreGaps={loreGaps}
              logs={logs}
              activeTab={activeTab}
              setActiveTab={setActiveTab}
              refetchClarifications={fetchClarifications}
              refetchLoreGaps={fetchLoreGaps}
              refetchLogs={fetchLogs}
            />
          </>
        )}

        {view === "lore" && (
          <LorePanel
            knowledgeFiles={knowledgeFiles}
            sourcePanel={
              <ObsidianVaultPanel
                status={vaultStatus}
                refreshStatus={fetchVaultStatus}
                onSourceChanged={() => void fetchKnowledge()}
              />
            }
            activeVaultPath={
              vaultStatus?.loreSource === "obsidian" && vaultStatus.vaultExists
                ? vaultStatus.vaultPath
                : null
            }
            clarificationCount={clarifications.length}
            tusksLore={tusksLore}
            tomesProbe={tomesProbe}
            tomesChronicles={tomesChronicles}
            refetchKnowledge={fetchKnowledge}
            refetchTusksLore={fetchTusksLore}
            refetchClarifications={fetchClarifications}
            refetchTomesStatus={fetchTomesStatus}
            onGoClarifications={() => {
              setView("home");
              setActiveTab("clarifications");
            }}
          />
        )}

        {view === "settings" && (
          <SettingsPanel
            keyVault={
              <KeyVaultPanel
                keys={keys}
                activeKey={activeKey}
                keyTestResults={keyTestResults}
                addKeyFor={addKeyFor}
                setAddKeyFor={setAddKeyFor}
                setNewKeyProvider={setNewKeyProvider}
                setNewKeyTier={setNewKeyTier}
                newKeyLabel={newKeyLabel}
                setNewKeyLabel={setNewKeyLabel}
                newKeyValue={newKeyValue}
                setNewKeyValue={setNewKeyValue}
                savingKey={savingKey}
                testKey={testKey}
                submitNewKey={submitNewKey}
                deleteStoredKey={deleteStoredKey}
                selectChannel={selectChannel}
              />
            }
            modelBrowser={
              <OpenRouterBrowser
                openrouterActive={(activeKey?.provider ?? provider) === "openrouter"}
                selectedModel={proModel}
                onPickModel={id => void pickModel(id)}
              />
            }
            personasPanel={<PersonasPanel api={personasApi} />}
            botName={botName}
            setBotName={setBotName}
            clarificationThreshold={clarificationThreshold}
            setClarificationThreshold={setClarificationThreshold}
            clarificationTopK={clarificationTopK}
            setClarificationTopK={setClarificationTopK}
            speculativeMode={speculativeMode}
            onToggleSpeculativeMode={toggleSpeculativeMode}
            togglingSpeculativeMode={togglingSpeculativeMode}
            speculativeError={speculativeError}
            includeReferences={includeReferences}
            togglingIncludeReferences={togglingIncludeReferences}
            onToggleIncludeReferences={toggleIncludeReferences}
            systemInstruction={systemInstruction}
            setSystemInstruction={setSystemInstruction}
            activePersona={activePersona}
            ollamaBaseUrl={ollamaBaseUrl}
            setOllamaBaseUrl={setOllamaBaseUrl}
            tomesSessionsPath={tomesSessionsPath}
            setTomesSessionsPath={setTomesSessionsPath}
            savingSettings={savingSettings}
            saveSuccess={saveSuccess}
            onSave={saveSettings}
            devModeUnlocked={devModeUnlocked}
          />
        )}

        {view === "help" && (
          <div className="space-y-4">
            {/* Documentation lives under one roof: the docs browser, the
                beginner's guide, the FAQ and About are pages of Help, not
                top-level destinations. */}
            <div className="flex bg-black/40 p-1 rounded-xl border border-white/10 overflow-x-auto w-fit max-w-full">
              {(
                [
                  ["docs", "Documentation"],
                  ["beginner", "Beginner's Guide"],
                  ["faq", "FAQ"],
                  ["about", "About"],
                ] as Array<[HelpPage, string]>
              ).map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => setHelpPage(id)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${helpPage === id ? "bg-gold-500 text-ink-950" : "text-white/40 hover:text-white/60"}`}
                >
                  {label}
                </button>
              ))}
            </div>
            {helpPage === "docs" && <DocsViewer />}
            {helpPage === "beginner" && <BeginnerGuidePage />}
            {helpPage === "faq" && <FaqPage />}
            {helpPage === "about" && <AboutPage />}
          </div>
        )}
      </main>

      {/* Buy Me a Coffee floating button */}
      <a
        href={BMC_URL}
        target="_blank"
        rel="noopener noreferrer"
        title="Buy Tusk a coffee"
        className="fixed bottom-6 right-6 z-40 group flex items-center gap-2 px-4 py-3 rounded-full bg-[#FFDD00] hover:bg-[#FFE84D] text-black font-bold text-sm shadow-lg shadow-yellow-500/20 transition-all hover:scale-105"
      >
        <Coffee size={18} />
        <span className="hidden group-hover:inline-block max-w-0 group-hover:max-w-[160px] overflow-hidden whitespace-nowrap transition-all duration-300">
          Buy me a coffee
        </span>
      </a>

      <DiscordSetupModal
        open={showDiscordSetup}
        onClose={() => setShowDiscordSetup(false)}
        discordConfigured={discordConfigured}
        discordMaskedToken={discordMaskedToken}
        discordAppId={discordAppId}
        discordInviteUrl={discordInviteUrl}
        refetchDiscord={fetchDiscord}
        refetchStatus={fetchStatus}
      />

      <OllamaInfoModal open={showOllamaInfo} onClose={() => setShowOllamaInfo(false)} />
    </div>
  );
}
