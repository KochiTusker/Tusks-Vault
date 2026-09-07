// Discord connect flow.
//
// Two steps, not three. It used to ask for the Application ID and the token
// separately; a bot token's first segment IS the application id, so the token
// alone gives us both — and the App ID field was the most reliable way to get
// setup wrong, because the Public Key and Client Secret sit beside it in the
// portal and are both plausible-looking strings that fail silently much later.
//
// What genuinely cannot be automated is called out rather than glossed:
// Discord has no API for creating an application, creating its bot user,
// issuing a token, or enabling an intent. Those are Developer Portal UI, so
// the honest goal is to make them short and unmistakable.
import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Bot,
  X,
  CheckCircle2,
  ExternalLink,
  Copy,
  Check,
  Save,
  Trash2,
  AlertTriangle,
} from "lucide-react";
import { FlameLoader } from "../FlameLoader";

interface Props {
  open: boolean;
  onClose: () => void;
  discordConfigured: boolean;
  discordMaskedToken: string | null;
  discordAppId: string;
  discordInviteUrl: string | null;
  refetchDiscord: () => Promise<void> | void;
  refetchStatus: () => Promise<void> | void;
}

interface Verdict {
  ok: boolean;
  botName?: string;
  appId?: string;
  error?: string;
}

export function DiscordSetupModal({
  open,
  onClose,
  discordConfigured,
  discordMaskedToken,
  discordAppId,
  discordInviteUrl,
  refetchDiscord,
  refetchStatus,
}: Props) {
  const [newToken, setNewToken] = useState("");
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [inviteCopied, setInviteCopied] = useState(false);
  const debounceRef = useRef<number | null>(null);

  // Verify as the user pastes, so "is this the right string?" is answered
  // while the Developer Portal is still open — not minutes later as a gateway
  // failure in a log. Debounced, because a paste fires several change events
  // and each one is a request to Discord.
  useEffect(() => {
    if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    setVerdict(null);
    const value = newToken.trim();
    if (!value) return;
    debounceRef.current = window.setTimeout(() => {
      void (async () => {
        setVerifying(true);
        try {
          const res = await fetch("/api/discord/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token: value }),
          });
          setVerdict((await res.json()) as Verdict);
        } catch (err) {
          setVerdict({ ok: false, error: (err as Error).message });
        } finally {
          setVerifying(false);
        }
      })();
    }, 600);
    return () => {
      if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    };
  }, [newToken]);

  const saveToken = async () => {
    if (!newToken.trim()) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/discord", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: newToken.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSaveError(data.error ?? "Could not save the token.");
        return;
      }
      setNewToken("");
      setVerdict(null);
      await refetchDiscord();
      await refetchStatus();
    } catch (err) {
      setSaveError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const disconnect = async () => {
    setSaving(true);
    try {
      await fetch("/api/discord", { method: "DELETE" });
      setNewToken("");
      setVerdict(null);
      await refetchDiscord();
      await refetchStatus();
    } catch (err) {
      console.error("Failed to disconnect Discord", err);
    } finally {
      setSaving(false);
    }
  };

  const copyInviteUrl = async () => {
    if (!discordInviteUrl) return;
    try {
      await navigator.clipboard.writeText(discordInviteUrl);
      setInviteCopied(true);
      setTimeout(() => setInviteCopied(false), 2000);
    } catch (err) {
      console.error("Clipboard write failed", err);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            onClick={e => e.stopPropagation()}
            className="scriptorium-card rounded-2xl p-8 max-w-2xl w-full max-h-[85vh] overflow-y-auto"
          >
            <div className="flex items-start justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gold-500/20 flex items-center justify-center text-gold-400">
                  <Bot size={20} />
                </div>
                <div>
                  <h3 className="text-2xl font-bold">Connect Discord</h3>
                  <p className="text-white/50 text-sm">
                    Two steps. The token is the only thing you need to copy.
                  </p>
                </div>
              </div>
              <button onClick={onClose} className="p-2 text-white/40 hover:text-white">
                <X size={20} />
              </button>
            </div>

            {discordConfigured && discordMaskedToken && (
              <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-3 mb-4 flex items-center gap-3 text-sm">
                <CheckCircle2 size={18} className="text-green-400" />
                <span>
                  Connected. Token <code className="font-mono text-green-300">{discordMaskedToken}</code>
                  {discordAppId && (
                    <>
                      {" "}
                      · App ID <code className="font-mono text-green-300">{discordAppId}</code>{" "}
                      <span className="text-white/40">(read from the token)</span>
                    </>
                  )}
                </span>
              </div>
            )}

            {/* Step 1 — the part Discord gives us no API for. */}
            <div className="bg-black/30 border border-white/5 rounded-2xl p-5 mb-4">
              <div className="flex items-center gap-2 mb-3">
                <span className="w-6 h-6 rounded-full bg-gold-500/20 text-gold-300 text-xs font-bold flex items-center justify-center">
                  1
                </span>
                <h4 className="text-sm font-bold uppercase tracking-widest text-white/80">
                  Make a bot and copy its token
                </h4>
              </div>
              <ol className="text-sm text-white/70 space-y-1.5 list-decimal ml-4 mb-3">
                <li>
                  Open the{" "}
                  <a
                    href="https://discord.com/developers/applications"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-gold-400 underline"
                  >
                    Discord Developer Portal
                  </a>{" "}
                  and click <strong>New Application</strong>. Any name — it's what the bot will be called.
                </li>
                <li>
                  Open the <strong>Bot</strong> tab on the left.
                </li>
                <li>
                  Turn on <strong>Message Content Intent</strong>.
                </li>
                <li>
                  Click <strong>Reset Token</strong>, then <strong>Copy</strong>.
                </li>
              </ol>
              <div className="flex items-start gap-2 rounded-md border border-yellow-400/30 bg-yellow-500/[0.06] px-3 py-2 text-xs leading-relaxed text-yellow-100/85">
                <AlertTriangle size={13} className="mt-0.5 flex-shrink-0 text-yellow-300" />
                <span>
                  Step 3 is the one people skip. Without Message Content Intent the bot connects, shows as
                  online, and receives every message with the text blank — so it looks broken rather than
                  unconfigured.
                </span>
              </div>
            </div>

            {/* Step 2 — paste. Everything else is derived. */}
            <div className="bg-black/30 border border-white/5 rounded-2xl p-5 mb-4">
              <div className="flex items-center gap-2 mb-3">
                <span className="w-6 h-6 rounded-full bg-gold-500/20 text-gold-300 text-xs font-bold flex items-center justify-center">
                  2
                </span>
                <h4 className="text-sm font-bold uppercase tracking-widest text-white/80">Paste it here</h4>
              </div>
              <div className="flex flex-col gap-2">
                <input
                  type="password"
                  value={newToken}
                  onChange={e => setNewToken(e.target.value)}
                  placeholder="Paste the bot token"
                  className="bg-black/50 border border-white/10 rounded-lg px-4 py-2 text-sm text-white placeholder:text-white/30 font-mono focus:outline-none focus:border-gold-400/60"
                />

                {verifying && (
                  <p className="flex items-center gap-2 text-xs text-white/50">
                    <FlameLoader size={12} /> Checking with Discord…
                  </p>
                )}

                {verdict?.ok && (
                  <div className="flex items-start gap-2 rounded-md border border-green-400/30 bg-green-500/[0.07] px-3 py-2 text-xs leading-relaxed text-green-100/90">
                    <CheckCircle2 size={13} className="mt-0.5 flex-shrink-0 text-green-400" />
                    <span>
                      This token works — it belongs to <strong>{verdict.botName}</strong>. Application ID{" "}
                      <code className="font-mono">{verdict.appId}</code>, read from the token, so there is
                      nothing else to copy.
                    </span>
                  </div>
                )}

                {verdict && !verdict.ok && verdict.error && (
                  <div className="rounded-md border border-red-400/30 bg-red-500/[0.06] px-3 py-2 text-xs leading-relaxed text-red-200/85">
                    {verdict.error}
                  </div>
                )}

                <button
                  onClick={saveToken}
                  disabled={saving || verifying || !newToken.trim() || verdict?.ok !== true}
                  className="flex items-center justify-center gap-2 px-4 py-2 bg-gold-500 hover:bg-gold-400 text-ink-950 disabled:opacity-40 rounded-lg text-sm font-bold transition-all"
                >
                  {saving ? <FlameLoader size={16} /> : <Save size={16} />}
                  {saving ? "Connecting…" : "Save & connect"}
                </button>

                {saveError && (
                  <div className="rounded-md border border-red-400/30 bg-red-500/[0.06] px-3 py-2 text-xs text-red-200/85">
                    {saveError}
                  </div>
                )}
              </div>
              <p className="text-[10px] text-white/30 mt-2">
                Saved to <code className="font-mono">.env.local</code> on this machine. Persists across
                restarts. Never pushed.
              </p>
            </div>

            {/* Step 3 — only meaningful once we know the App ID. */}
            {discordInviteUrl && (
              <div className="bg-green-500/5 border border-green-500/20 rounded-2xl p-5 mb-4">
                <div className="flex items-center gap-2 mb-3">
                  <span className="w-6 h-6 rounded-full bg-green-500/20 text-green-300 text-xs font-bold flex items-center justify-center">
                    3
                  </span>
                  <h4 className="text-sm font-bold uppercase tracking-widest text-white/80">
                    Invite it to your server
                  </h4>
                </div>
                <p className="text-sm text-white/70 mb-3">
                  This link already carries the right scopes and permissions — Send Messages, Embed Links,
                  Read Message History, Attach Files, Add Reactions. Open it, pick your campaign server,
                  click Authorize.
                </p>
                <div className="flex gap-2">
                  <a
                    href={discordInviteUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-500 rounded-lg text-sm font-bold transition-all"
                  >
                    <ExternalLink size={14} /> Open invite link
                  </a>
                  <button
                    onClick={copyInviteUrl}
                    className="px-4 py-2 bg-white/5 hover:bg-white/10 rounded-lg text-xs font-bold transition-all flex items-center gap-1"
                  >
                    {inviteCopied ? (
                      <>
                        <Check size={14} /> Copied
                      </>
                    ) : (
                      <>
                        <Copy size={14} /> Copy
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}

            {(discordConfigured || discordAppId) && (
              <div className="flex justify-between items-center pt-2">
                <button
                  onClick={disconnect}
                  disabled={saving}
                  className="text-xs text-red-400/70 hover:text-red-400 transition-colors flex items-center gap-1"
                >
                  <Trash2 size={12} /> Disconnect Discord
                </button>
                <button
                  onClick={onClose}
                  className="px-4 py-2 bg-white/5 hover:bg-white/10 rounded-lg text-xs font-bold transition-all"
                >
                  Close
                </button>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
