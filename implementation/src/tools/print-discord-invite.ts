import { PermissionFlagsBits } from "discord.js";

const permissions = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.SendMessagesInThreads
].reduce((sum, value) => sum | value, 0n);

function main(): void {
  const applicationId = process.argv[2] ?? process.env.DISCORD_APPLICATION_ID;
  if (!applicationId) {
    throw new Error(
      "DISCORD_APPLICATION_ID is required. Pass it as an argument or define it in the environment."
    );
  }

  const url = new URL("https://discord.com/oauth2/authorize");

  url.searchParams.set("client_id", applicationId);
  url.searchParams.set("scope", "bot");
  url.searchParams.set("permissions", permissions.toString());

  process.stdout.write(`${url.toString()}\n`);
}

main();
