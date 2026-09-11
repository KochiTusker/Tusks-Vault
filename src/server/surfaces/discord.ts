// Discord, reduced to plumbing.
//
// This file used to be discord/handler.ts and contained the whole product:
// prompt assembly, persona resolution, the adapter call, lore-gap recording,
// citation stripping. All of that now lives in chat/ask.ts, where the other
// surfaces can reach it.
//
// What is left is genuinely Discord-shaped and belongs nowhere else: knowing
// that a mention or a DM is an invitation to answer, that `<@id>` has to come
// out of the text, that a typing indicator exists, and that 2000 characters is
// a hard ceiling.

import { Message } from "discord.js";
import { parseDiscordAttachments } from "../knowledge/attachments";
import { chatSafeError } from "../llm/registry";
import { buildDiagnosticBundle } from "../diagnose/bundle";
import { answerGate, ask } from "../chat/ask";
import { discordClient } from "../discord/client";

const DISCORD_MAX_LEN = 2000;

export function registerDiscordHandlers(): void {
  discordClient.on("messageCreate", handleMessage);
}

async function handleMessage(message: Message): Promise<void> {
  if (message.author.bot) return;

  const isMentioned = message.mentions.has(discordClient.user!);
  const isDM = !message.guild;
  if (!isMentioned && !isDM) return;

  try {
    // FIRST, before any side effect. A paused or switched-off bot is
    // completely silent: no "Tusk is typing…" flicker, no reply to a bare
    // mention, no attachment parsing, no token spend. The bot stays logged
    // into Discord so unpausing from the dashboard is instant, and Discord's
    // presence indicator still shows it online.
    const gate = answerGate("discord");
    if (!gate.allowed) {
      console.log(`[discord] ${gate.reason} — ignoring mention from ${message.author.tag}`);
      return;
    }

    const userPrompt = stripMention(message.content, discordClient.user?.id);

    if (!userPrompt && message.attachments.size === 0) {
      await message.reply("How can I help you today?");
      return;
    }

    const parts =
      message.attachments.size > 0
        ? await parseDiscordAttachments(message.attachments.values())
        : undefined;

    const typing = startTyping(message);
    let result;
    try {
      result = await ask({
        text: userPrompt,
        parts,
        asker: { id: message.author.id, displayName: message.author.tag },
        surface: "discord",
      });
    } finally {
      typing.stop();
    }

    if (!result.answered) {
      // `paused` and `disabled` are deliberate silence — the user switched
      // the bot off and a reply would contradict that. `empty` is a failure
      // the user needs told about, because silence there is indistinguishable
      // from the bot ignoring them.
      if (result.skipped === "empty") {
        await message.reply(
          "I'm sorry, I couldn't generate a response. The content might have been blocked or the model failed to respond."
        );
      }
      return;
    }

    await replyChunked(message, result.text!);
  } catch (error) {
    console.error("Error processing message:", error);
    // A failed reply is exactly when the state snapshot matters — write a
    // diagnostic bundle in the background. Best-effort: bundling must never
    // compound the failure it documents.
    void buildDiagnosticBundle(`discord reply error: ${(error as Error)?.message ?? String(error)}`).catch(
      () => {}
    );
    // Verbose to Vault's own console (above) and to the diagnostic bundle;
    // generic to the channel. The operator message names the provider, the
    // model and the env var to set — a channel is the wrong audience for all
    // three, and the GM reads the console, not the chat log.
    await message.reply(chatSafeError(error));
  }
}

/** Discord's typing indicator lapses after ~10s, and an answer can take
 *  longer than that — a single sendTyping leaves the user watching nothing
 *  for the rest of the wait. Refresh it until the answer lands. */
function startTyping(message: Message): { stop: () => void } {
  const send = () => {
    if (message.channel && "sendTyping" in message.channel) {
      void (message.channel as { sendTyping: () => Promise<void> }).sendTyping().catch(() => {});
    }
  };
  send();
  const timer = setInterval(send, 8_000);
  return { stop: () => clearInterval(timer) };
}

function stripMention(content: string, botId: string | undefined): string {
  if (!botId) return content.trim();
  return content.replace(`<@!${botId}>`, "").replace(`<@${botId}>`, "").trim();
}

async function replyChunked(message: Message, text: string): Promise<void> {
  if (text.length <= DISCORD_MAX_LEN) {
    await message.reply(text || "I'm sorry, I couldn't generate a response.");
    return;
  }
  const chunks = text.match(new RegExp(`[\\s\\S]{1,${DISCORD_MAX_LEN}}`, "g")) || [];
  for (const chunk of chunks) {
    await message.reply(chunk);
  }
}
