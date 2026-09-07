import { Client, GatewayIntentBits, Partials } from "discord.js";

export const discordClient = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel],
});

export const botState = {
  status: "Offline" as string,
};

discordClient.on("clientReady", () => {
  console.log(`Logged in as ${discordClient.user?.tag}!`);
  botState.status = "Online";
});

export function loginDiscord(): void {
  if (!process.env.DISCORD_TOKEN) {
    botState.status = "Error: Missing Token";
    return;
  }
  discordClient.login(process.env.DISCORD_TOKEN).catch(err => {
    console.error("Failed to login to Discord:", err);
    if (err.message?.includes("Used disallowed intents")) {
      botState.status = "Error: Enable 'Message Content Intent' in Discord Portal";
    } else {
      botState.status = "Error: Invalid Token";
    }
  });
}

// Used when the user updates the bot token from the dashboard. Tears down the
// existing connection and re-logs in with whatever DISCORD_TOKEN now is.
export async function reloginDiscord(): Promise<void> {
  try {
    await discordClient.destroy();
  } catch (err) {
    console.warn("Discord client destroy error (continuing):", err);
  }
  botState.status = "Reconnecting...";
  loginDiscord();
}
