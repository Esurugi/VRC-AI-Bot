import { randomUUID } from "node:crypto";
import {
  ApplicationCommandDataResolvable,
  ChannelType,
  PermissionFlagsBits,
  PermissionsBitField,
  SlashCommandBuilder,
  ThreadAutoArchiveDuration,
  type AnyThreadChannel,
  type Channel,
  type ChatInputCommandInteraction,
  type Client,
  type NewsChannel,
  type TextChannel
} from "discord.js";
import type { Logger } from "pino";

import { splitPlainTextReplies } from "../../app/replies.js";
import { SessionManager } from "../../codex/session-manager.js";
import { SessionPolicyResolver } from "../../codex/session-policy.js";
import { resolvePlaceType } from "../../discord/message-utils.js";
import type { AppConfig, WatchLocationConfig } from "../../domain/types.js";
import { DEFAULT_OVERRIDE_FLAGS, type OverrideFlags } from "../../override/types.js";
import { SqliteStore } from "../../storage/database.js";
import { WeeklyMeetupAnnouncementService } from "../scheduling/weekly-meetup-announcement-service.js";
import { AdminOverrideBootstrapService } from "./admin-override-bootstrap-service.js";
import { OverrideBootstrapPromptContextService } from "./override-bootstrap-prompt-context-service.js";

export class AdminCommandService {
  constructor(
    private readonly client: Client,
    private readonly config: AppConfig,
    private readonly store: SqliteStore,
    private readonly sessionManager: SessionManager,
    private readonly sessionPolicyResolver: SessionPolicyResolver,
    private readonly adminOverrideBootstrapService: AdminOverrideBootstrapService,
    private readonly overrideBootstrapPromptContextService: OverrideBootstrapPromptContextService,
    private readonly weeklyMeetupAnnouncementService: WeeklyMeetupAnnouncementService,
    private readonly logger: Logger
  ) {}

  async registerCommands(): Promise<void> {
    const guildIds = [...new Set(this.config.watchLocations.map((location) => location.guildId))];
    const commands = buildOverrideCommandDefinitions();

    for (const guildId of guildIds) {
      try {
        const guild = await this.client.guilds.fetch(guildId);
        const existingCommands = await guild.commands.fetch();
        await guild.commands.set(
          mergeOverrideCommandDefinitions([...existingCommands.values()], commands)
        );
      } catch (error) {
        this.logger.warn(
          {
            guildId,
            error: error instanceof Error ? error.message : String(error)
          },
          "failed to register admin commands"
        );
      }
    }
  }

  async handle(interaction: ChatInputCommandInteraction): Promise<boolean> {
    if (
      interaction.commandName !== "override-start" &&
      interaction.commandName !== "override-end" &&
      interaction.commandName !== "weekly-meetup-test"
    ) {
      return false;
    }

    if (!interaction.inCachedGuild()) {
      await replyToInteraction(interaction, "guild 内でのみ使える command です。");
      return true;
    }

    const watchLocation = resolveCommandWatchLocation(
      interaction.channel,
      this.config.watchLocations
    );
    if (!watchLocation) {
      await replyToInteraction(
        interaction,
        "この command は configured な会話 place でのみ使えます。"
      );
      return true;
    }

    const actorRole = resolveInteractionActorRole(
      interaction,
      this.config.discordOwnerUserIds
    );
    if (actorRole === "user") {
      await replyToInteraction(
        interaction,
        "Administrator 権限を持つ owner/admin だけがこの command を使えます。"
      );
      return true;
    }

    if (interaction.commandName === "weekly-meetup-test") {
      if (!isAdminControlRootPlace(interaction.channel, watchLocation)) {
        await replyToInteraction(
          interaction,
          "この command は configured `admin_control` root channel でのみ使えます。"
        );
        return true;
      }

      const result = await this.weeklyMeetupAnnouncementService.sendTestAnnouncement();
      if (!result.ok) {
        await replyToInteraction(
          interaction,
          buildWeeklyMeetupTestFailureReply(result.reason)
        );
        return true;
      }

      await replyToInteraction(
        interaction,
        `weekly meetup 告知の TEST 送信を実行しました。target=<#${result.channelId}>`
      );
      return true;
    }

    if (interaction.commandName === "override-start") {
      if (!isConversationCapableOverrideStartPlace(interaction.channel, watchLocation)) {
        await replyToInteraction(
          interaction,
          "この command は configured `chat` / `admin_control` / `forum_longform` の会話 place でのみ使えます。forum_longform では post thread 内で実行してください。"
        );
        return true;
      }

      const adminWatchLocation = findAdminControlWatchLocation(
        this.config.watchLocations,
        interaction.guildId
      );
      if (!adminWatchLocation) {
        await replyToInteraction(
          interaction,
          "この guild には override thread 作成先の configured `admin_control` root channel がありません。"
        );
        return true;
      }

      const adminRootChannel = await this.client.channels.fetch(adminWatchLocation.channelId);
      if (!isBaseWatchChannel(adminRootChannel)) {
        await replyToInteraction(
          interaction,
          "override thread の作成先は text/announcement の `admin_control` root channel である必要があります。"
        );
        return true;
      }

      const startedAt = new Date().toISOString();
      const flags = readOverrideFlags(interaction);
      const initialPrompt = interaction.options.getString("prompt")?.trim() ?? "";
      const effectiveContentOverride =
        initialPrompt.length > 0 && interaction.channel
          ? await this.overrideBootstrapPromptContextService.buildEffectivePrompt({
              prompt: initialPrompt,
              origin: buildCommandOriginContext(interaction, watchLocation),
              historyChannel: interaction.channel
            })
          : null;
      const overrideThread = await adminRootChannel.threads.create({
        name: buildOverrideThreadName(interaction),
        autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
        reason: `override-start by ${interaction.user.id}`
      });
      this.store.overrideSessions.start({
        sessionId: randomUUID(),
        guildId: interaction.guildId,
        actorId: interaction.user.id,
        grantedBy: interaction.user.id,
        scopePlaceId: overrideThread.id,
        flags,
        sandboxMode: "workspace-write",
        startedAt
      });
      if (initialPrompt.length === 0) {
        await overrideThread.send({
          content:
            `override thread を開きました。sandbox=workspace-write flags=${summarizeOverrideFlags(flags)}\n` +
            "この thread では、override を開始した管理者本人の会話全体が workspace-write context です。\n" +
            "終了するときはこの thread で `/override-end` を実行してください。",
          allowedMentions: { parse: [] }
        });
      } else {
        await sendVisiblePromptCopyToThread(overrideThread, initialPrompt);
      }
      await replyToInteraction(
        interaction,
        initialPrompt.length > 0
          ? `override thread を開きました。thread=<#${overrideThread.id}> sandbox=workspace-write flags=${summarizeOverrideFlags(flags)} 最初の依頼を thread 先頭にコピーし、bootstrap として投入します。`
          : `override thread を開きました。thread=<#${overrideThread.id}> sandbox=workspace-write flags=${summarizeOverrideFlags(flags)}`
      );
      if (initialPrompt.length > 0) {
        await this.adminOverrideBootstrapService.bootstrapPrompt({
          thread: overrideThread,
          watchLocation: adminWatchLocation,
          actorId: interaction.user.id,
          actorRole,
          prompt: initialPrompt,
          effectiveContentOverride,
          requestId: `override-bootstrap:${interaction.id}`
        });
      }
      return true;
    }

    if (!interaction.channel?.isThread()) {
      await replyToInteraction(
        interaction,
        "この command は dedicated override thread 内でのみ使えます。"
      );
      return true;
    }

    const scopePlaceId = interaction.channelId;
    const active = this.store.overrideSessions.getActive(
      interaction.guildId,
      scopePlaceId,
      interaction.user.id
    );
    if (!active) {
      await replyToInteraction(
        interaction,
        "この thread に終了対象の active override はありません。override を開いた管理者本人が同じ thread で実行してください。"
      );
      return true;
    }

    const archivedWriteSession = await this.sessionManager.archiveSession(
      this.sessionPolicyResolver.resolveAdminOverrideThread({
        threadId: scopePlaceId,
        actorId: interaction.user.id
      })
    );

    const ended = this.store.overrideSessions.endActive({
      guildId: interaction.guildId,
      scopePlaceId,
      actorId: interaction.user.id,
      endedAt: new Date().toISOString(),
      endedBy: interaction.user.id,
      cleanupReason: null
    });
    if (!ended) {
      await replyToInteraction(
        interaction,
        "この thread に終了対象の active override はありません。"
      );
      return true;
    }

    await replyToInteraction(
      interaction,
      `override を終了しました。thread=${scopePlaceId} sandbox=read-only この thread を archive します。`
    );
    if (!archivedWriteSession.archived) {
      this.logger.debug(
        {
          threadId: scopePlaceId,
          actorId: interaction.user.id
        },
        "override ended without a persisted workspace-write session binding"
      );
    }
    await interaction.channel.setArchived(true, `override-end by ${interaction.user.id}`);
    return true;
  }
}

export function mergeOverrideCommandDefinitions(
  existingCommands: Array<{
    name: string;
    toJSON(): unknown;
  }>,
  desiredCommands: ApplicationCommandDataResolvable[]
): ApplicationCommandDataResolvable[] {
  const desiredNames = new Set(
    desiredCommands.map((command) => {
      const resolved = command as { name?: string };
      if (!resolved.name) {
        throw new Error("override command definition is missing a name");
      }
      return resolved.name;
    })
  );

  return [
    ...existingCommands
      .filter((command) => !desiredNames.has(command.name))
      .map((command) => command.toJSON() as ApplicationCommandDataResolvable),
    ...desiredCommands
  ];
}

export function buildOverrideCommandDefinitions(): ApplicationCommandDataResolvable[] {
  return [
    new SlashCommandBuilder()
      .setName("override-start")
      .setDescription("Open a dedicated override thread for workspace-write self-modification")
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addStringOption((option) =>
        option
          .setName("prompt")
          .setDescription("Optional hidden initial prompt to run in the new override thread")
          .setRequired(false)
      )
      .addBooleanOption((option) =>
        option
          .setName("allow_playwright_headed")
          .setDescription("Allow headed Playwright for this override")
          .setRequired(false)
      )
      .addBooleanOption((option) =>
        option
          .setName("allow_playwright_persistent")
          .setDescription("Allow persistent Playwright profile for this override")
          .setRequired(false)
      )
      .addBooleanOption((option) =>
        option
          .setName("allow_prompt_injection_test")
          .setDescription("Allow prompt-injection testing for this override")
          .setRequired(false)
      )
      .addBooleanOption((option) =>
        option
          .setName("suspend_violation_counter")
          .setDescription("Suspend violation counter in this place during override")
          .setRequired(false)
      )
      .addBooleanOption((option) =>
        option
          .setName("allow_private_external_fetch")
          .setDescription("Allow external fetch in private context without private terms")
          .setRequired(false)
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName("override-end")
      .setDescription("Close this override thread and return it to read-only mode")
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .toJSON(),
    new SlashCommandBuilder()
      .setName("weekly-meetup-test")
      .setDescription("Send the configured weekly meetup announcement embed once as a TEST")
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .toJSON()
  ];
}

function findAdminControlWatchLocation(
  watchLocations: WatchLocationConfig[],
  guildId: string
): WatchLocationConfig | null {
  return (
    watchLocations.find(
      (location) => location.guildId === guildId && location.mode === "admin_control"
    ) ?? null
  );
}

function resolveInteractionActorRole(
  interaction: ChatInputCommandInteraction,
  ownerUserIds: string[]
): "owner" | "admin" | "user" {
  if (ownerUserIds.includes(interaction.user.id)) {
    return "owner";
  }

  if (interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator)) {
    return "admin";
  }

  return "user";
}

function resolveCommandWatchLocation(
  channel: Channel | null,
  watchLocations: WatchLocationConfig[]
): WatchLocationConfig | null {
  if (!channel) {
    return null;
  }

  const direct = watchLocations.find((location) => location.channelId === channel.id);
  if (direct) {
    return direct;
  }

  if (channel.isThread()) {
    return (
      watchLocations.find((location) => location.channelId === channel.parentId) ?? null
    );
  }

  return null;
}

function isConversationCapableOverrideStartPlace(
  channel: Channel | null,
  watchLocation: WatchLocationConfig
): boolean {
  if (!channel || watchLocation.mode === "url_watch") {
    return false;
  }

  if (watchLocation.mode === "forum_longform") {
    return channel.isThread();
  }

  return true;
}

function isAdminControlRootPlace(
  channel: Channel | null,
  watchLocation: WatchLocationConfig
): boolean {
  return Boolean(
    channel &&
      !channel.isThread() &&
      watchLocation.mode === "admin_control" &&
      watchLocation.channelId === channel.id
  );
}

function buildCommandOriginContext(
  interaction: ChatInputCommandInteraction,
  watchLocation: WatchLocationConfig
): {
  guildId: string;
  channelId: string;
  rootChannelId: string;
  threadId: string | null;
  mode: WatchLocationConfig["mode"];
  placeType: ReturnType<typeof resolvePlaceType>;
} {
  if (!interaction.channel || !interaction.inCachedGuild()) {
    throw new Error("override command origin context requires a cached guild channel");
  }

  return {
    guildId: interaction.guildId,
    channelId: interaction.channelId,
    rootChannelId: watchLocation.channelId,
    threadId: interaction.channel.isThread() ? interaction.channelId : null,
    mode: watchLocation.mode,
    placeType: resolvePlaceType(interaction.channel, watchLocation.mode)
  };
}

function buildOverrideThreadName(interaction: ChatInputCommandInteraction): string {
  const stamp = new Date().toISOString().slice(11, 19).replace(/:/g, "");
  return `override-${interaction.user.username}-${stamp}`.slice(0, 100);
}

function readOverrideFlags(interaction: ChatInputCommandInteraction): OverrideFlags {
  return {
    allowPlaywrightHeaded:
      interaction.options.getBoolean("allow_playwright_headed") ??
      DEFAULT_OVERRIDE_FLAGS.allowPlaywrightHeaded,
    allowPlaywrightPersistent:
      interaction.options.getBoolean("allow_playwright_persistent") ??
      DEFAULT_OVERRIDE_FLAGS.allowPlaywrightPersistent,
    allowPromptInjectionTest:
      interaction.options.getBoolean("allow_prompt_injection_test") ??
      DEFAULT_OVERRIDE_FLAGS.allowPromptInjectionTest,
    suspendViolationCounterForCurrentThread:
      interaction.options.getBoolean("suspend_violation_counter") ??
      DEFAULT_OVERRIDE_FLAGS.suspendViolationCounterForCurrentThread,
    allowExternalFetchInPrivateContextWithoutPrivateTerms:
      interaction.options.getBoolean("allow_private_external_fetch") ??
      DEFAULT_OVERRIDE_FLAGS.allowExternalFetchInPrivateContextWithoutPrivateTerms
  };
}

function summarizeOverrideFlags(flags: OverrideFlags): string {
  const enabled = Object.entries(flags)
    .filter(([, value]) => value)
    .map(([key]) => key);

  return enabled.length > 0 ? enabled.join(",") : "none";
}

async function replyToInteraction(
  interaction: ChatInputCommandInteraction,
  content: string
): Promise<void> {
  if (interaction.replied || interaction.deferred) {
    await interaction.followUp({
      content,
      allowedMentions: { parse: [] }
    });
    return;
  }

  await interaction.reply({
    content,
    allowedMentions: { parse: [] }
  });
}

async function sendVisiblePromptCopyToThread(
  thread: AnyThreadChannel,
  prompt: string
): Promise<void> {
  const visibleCopy = `初回 prompt:\n${prompt.trim()}`;

  for (const chunk of splitPlainTextReplies(visibleCopy)) {
    await thread.send({
      content: chunk,
      allowedMentions: { parse: [] }
    });
  }
}

function buildWeeklyMeetupTestFailureReply(
  reason:
    | "not_configured"
    | "channel_fetch_not_configured"
    | "invalid_channel"
    | "template_read_failed"
    | "send_failed"
): string {
  switch (reason) {
    case "not_configured":
      return "weekly meetup 告知設定がありません。";
    case "channel_fetch_not_configured":
      return "weekly meetup 告知送信の channel fetch が未設定です。";
    case "invalid_channel":
      return "weekly meetup 告知先 channel が text/announcement ではありません。";
    case "template_read_failed":
      return "weekly meetup 告知 template の読み込みに失敗しました。";
    case "send_failed":
      return "weekly meetup 告知の TEST 送信に失敗しました。";
  }
}

function isBaseWatchChannel(
  channel: Channel | null
): channel is TextChannel | NewsChannel {
  if (!channel) {
    return false;
  }

  return (
    channel.type === ChannelType.GuildText ||
    channel.type === ChannelType.GuildAnnouncement
  );
}
