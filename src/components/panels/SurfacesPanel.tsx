// Surfaces — where the bot answers, and who is allowed to ask.
//
// Self-contained: it reads and writes its own slice of settings rather than
// threading four more pieces of state through App. The pairing prompt is the
// reason this panel has to poll — a GM clicking Connect in Foundry needs the
// Allow/Deny to appear here within a second or two, and there is no push
// channel to the dashboard.
//
// Note what is deliberately NOT here: the Foundry access mode. That lives in
// the Foundry module, world-scoped, because it is a property of the table
// rather than of this install — a GM running two campaigns can want different
// answers for each — and because Vault cannot verify who asked anyway. A second
// control here that did not drive anything would be worse than no control.
import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Check, Dices, Link2, MessageSquare, Plug, ShieldAlert, Trash2, X } from "lucide-react";

type SurfaceId = "discord" | "foundry" | "mcp";

interface SurfaceConfig {
  enabled: boolean;
  provider?: string;
  model?: string;
  allowPlayers?: boolean;
}

interface PendingPairing {
  requestId: string;
  code: string;
  origin: string;
  surface: SurfaceId;
  clientName: string;
  worldTitle: string;
  foundryVersion: string;
  expiresAt: number;
}

interface PairedClient {
  id: string;
  label: string;
  origin: string;
  surface: SurfaceId;
  createdAt: string;
  lastSeenAt?: string;
}

const PAIRING_POLL_MS = 3000;

export function SurfacesPanel() {
  const [surfaces, setSurfaces] = useState<Record<SurfaceId, SurfaceConfig> | null>(null);
  const [provider, setProvider] = useState<string>("");
  const [pending, setPending] = useState<PendingPairing | null>(null);
  const [clients, setClients] = useState<PairedClient[]>([]);
  const [busy, setBusy] = useState(false);
  // Kept in a ref so the poll interval never restarts when it changes — a
  // restarting interval is a poll that can starve.
  const pendingRef = useRef<string | null>(null);

  const loadSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/settings");
      const data = await res.json();
      setSurfaces(data.surfaces ?? null);
      setProvider(data.provider ?? "");
    } catch {
      /* the dashboard shows its own connection banner */
    }
  }, []);

  const loadClients = useCallback(async () => {
    try {
      const res = await fetch("/api/mcp/clients");
      const data = await res.json();
      setClients(Array.isArray(data.clients) ? data.clients : []);
    } catch {
      /* leave the last known list up */
    }
  }, []);

  useEffect(() => {
    void loadSettings();
    void loadClients();
  }, [loadSettings, loadClients]);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch("/api/mcp/pair/pending");
        const data = await res.json();
        if (cancelled) return;
        const next: PendingPairing | null = data.pending ?? null;
        setPending(next);
        // A request that vanished was approved or denied somewhere else, or it
        // lapsed. Either way the client list may have changed.
        if (pendingRef.current && !next) void loadClients();
        pendingRef.current = next?.requestId ?? null;
      } catch {
        /* transient — the next tick retries */
      }
    };
    void poll();
    const timer = setInterval(poll, PAIRING_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [loadClients]);

  const patchSurface = async (id: SurfaceId, patch: Partial<SurfaceConfig>) => {
    setBusy(true);
    // Optimistic, then reconciled against what the server says it persisted.
    setSurfaces(prev => (prev ? { ...prev, [id]: { ...prev[id], ...patch } } : prev));
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ surfaces: { [id]: patch } }),
      });
      const data = await res.json();
      if (data?.settings?.surfaces) setSurfaces(data.settings.surfaces);
    } finally {
      setBusy(false);
    }
  };

  const decide = async (action: "approve" | "deny") => {
    if (!pending) return;
    setBusy(true);
    try {
      await fetch(`/api/mcp/pair/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: pending.requestId }),
      });
      setPending(null);
      await loadClients();
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: string) => {
    setBusy(true);
    try {
      await fetch(`/api/mcp/clients/${encodeURIComponent(id)}`, { method: "DELETE" });
      await loadClients();
    } finally {
      setBusy(false);
    }
  };

  if (!surfaces) return null;

  const foundryClients = clients.filter(c => c.surface === "foundry");
  const mcpClients = clients.filter(c => c.surface === "mcp");
  const claudeCodePinned = (id: SurfaceId) =>
    (surfaces[id].provider ?? provider) === "claudeCode";

  return (
    <section className="scriptorium-card relative rounded-2xl p-4 mb-4 parchment">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-white/5 text-gold-200 flex-shrink-0">
          <Plug size={20} />
        </div>
        <div className="min-w-0">
          <h3 className="font-display text-base font-bold tracking-wide text-gold-200">Surfaces</h3>
          <p className="text-[11px] text-white/50 leading-snug mt-0.5">
            Where the archivist answers. Each one switches on independently.
          </p>
        </div>
      </div>

      <AnimatePresence>
        {pending && (
          <motion.div
            key="pairing"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden mb-3"
          >
            <div className="rounded-xl border border-gold-500/40 bg-gold-500/[0.07] p-3">
              <div className="flex items-center gap-2 mb-2">
                <Link2 size={14} className="text-gold-300" />
                <span className="font-display text-sm font-bold text-gold-200">
                  Something wants to connect
                </span>
              </div>
              <p className="text-[11px] text-white/60 leading-snug mb-2">
                {pending.clientName}
                {pending.worldTitle ? ` — ${pending.worldTitle}` : ""}
                {pending.foundryVersion ? ` (Foundry ${pending.foundryVersion})` : ""} at{" "}
                <code className="text-white/80">{pending.origin || "this machine"}</code>.
              </p>
              <p className="text-[11px] text-white/60 leading-snug mb-2">
                Check this code matches the one shown in {pending.surface === "foundry" ? "Foundry" : "the app asking"}.
                If it does not, deny it — something else asked to connect.
              </p>
              <div className="font-mono text-3xl tracking-[0.3em] text-center text-gold-100 my-2">
                {pending.code}
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void decide("approve")}
                  className="flex-1 flex items-center justify-center gap-1.5 rounded-lg border border-green-500/40 bg-green-500/10 px-3 py-2 text-xs font-bold text-green-200 hover:bg-green-500/20 disabled:opacity-50"
                >
                  <Check size={14} /> Allow
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void decide("deny")}
                  className="flex-1 flex items-center justify-center gap-1.5 rounded-lg border border-crimson-500/40 bg-crimson-500/10 px-3 py-2 text-xs font-bold text-crimson-200 hover:bg-crimson-500/20 disabled:opacity-50"
                >
                  <X size={14} /> Deny
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="space-y-2">
        <SurfaceRow
          icon={<MessageSquare size={16} />}
          title="Discord"
          blurb="Answers @mentions and DMs in your server."
          enabled={surfaces.discord.enabled}
          busy={busy}
          onToggle={v => void patchSurface("discord", { enabled: v })}
        />

        <SurfaceRow
          icon={<Dices size={16} />}
          title="Foundry VTT"
          blurb="Answers /tusk in the game chat bar, through the Tusk's Vault module."
          enabled={surfaces.foundry.enabled}
          busy={busy}
          onToggle={v => void patchSurface("foundry", { enabled: v })}
        >
          <label className="flex items-start gap-2 mt-2 cursor-pointer">
            <input
              type="checkbox"
              checked={surfaces.foundry.allowPlayers === true}
              disabled={busy}
              onChange={e => void patchSurface("foundry", { allowPlayers: e.target.checked })}
              className="mt-0.5"
            />
            <span className="text-[11px] text-white/60 leading-snug">
              <span className="text-white/80 font-medium">Answer players, not just the GM.</span> This is a
              ceiling, not the table's access mode — that lives in Foundry, under the module's settings,
              because only Foundry knows who asked. Leave it off and player questions are refused here
              however the module is configured.
            </span>
          </label>
          {surfaces.foundry.enabled && surfaces.foundry.allowPlayers && (
            <p className="flex items-start gap-1.5 mt-2 text-[11px] text-amber-200/80 leading-snug">
              <ShieldAlert size={13} className="mt-0.5 flex-shrink-0" />
              The archive answers from your whole corpus and has no notion of what you have revealed.
              A player can pull unrevealed lore — whispering hides it from the table, not from them.
            </p>
          )}
          <ClientList clients={foundryClients} busy={busy} onRevoke={revoke} />
          {claudeCodePinned("foundry") && <ClaudeCodeCost />}
        </SurfaceRow>

        <SurfaceRow
          icon={<Plug size={16} />}
          title="Other MCP clients"
          blurb="Lets Claude Code, Claude Desktop, or any MCP client query the same corpus."
          enabled={surfaces.mcp.enabled}
          busy={busy}
          onToggle={v => void patchSurface("mcp", { enabled: v })}
        >
          <ClientList clients={mcpClients} busy={busy} onRevoke={revoke} />
          {claudeCodePinned("mcp") && <ClaudeCodeCost />}
        </SurfaceRow>
      </div>
    </section>
  );
}

function SurfaceRow(props: {
  icon: React.ReactNode;
  title: string;
  blurb: string;
  enabled: boolean;
  busy: boolean;
  onToggle: (value: boolean) => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
      <div className="flex items-start gap-3">
        <div
          className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
            props.enabled ? "bg-green-500/15 text-green-300" : "bg-white/5 text-white/35"
          }`}
        >
          {props.icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-display text-sm font-bold text-foreground-strong">{props.title}</div>
          <p className="text-[11px] text-white/50 leading-snug mt-0.5">{props.blurb}</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={props.enabled}
          aria-label={`${props.enabled ? "Disable" : "Enable"} ${props.title}`}
          disabled={props.busy}
          onClick={() => props.onToggle(!props.enabled)}
          className={`flex-shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest transition-colors disabled:opacity-50 ${
            props.enabled
              ? "bg-green-500/20 text-green-200 hover:bg-green-500/30"
              : "bg-white/5 text-white/45 hover:bg-white/10"
          }`}
        >
          {props.enabled ? "On" : "Off"}
        </button>
      </div>
      {props.children}
    </div>
  );
}

function ClientList(props: { clients: PairedClient[]; busy: boolean; onRevoke: (id: string) => void }) {
  if (props.clients.length === 0) {
    return (
      <p className="text-[11px] text-white/40 italic mt-2">
        Nothing paired yet. Pair from the client itself — it will ask, and you approve it here.
      </p>
    );
  }
  return (
    <ul className="mt-2 space-y-1">
      {props.clients.map(client => (
        <li
          key={client.id}
          className="flex items-center gap-2 rounded-lg bg-black/20 px-2 py-1.5 text-[11px]"
        >
          <span className="text-white/75 truncate flex-1">
            {client.label}
            {client.origin ? <span className="text-white/40"> · {client.origin}</span> : null}
          </span>
          <button
            type="button"
            disabled={props.busy}
            onClick={() => props.onRevoke(client.id)}
            title="Revoke — the connection drops immediately"
            aria-label={`Revoke ${client.label}`}
            className="flex-shrink-0 text-white/40 hover:text-crimson-300 disabled:opacity-50"
          >
            <Trash2 size={13} />
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Pinning a surface to Claude Code is a real trade, and the user should make
 *  it knowingly: free at the margin, but slow and strictly one at a time. */
function ClaudeCodeCost() {
  return (
    <p className="text-[11px] text-white/45 leading-snug mt-2 italic">
      Answering on your Claude Code subscription: no metered billing, but 5–10 seconds per answer and
      one at a time. Questions queue rather than run together.
    </p>
  );
}
