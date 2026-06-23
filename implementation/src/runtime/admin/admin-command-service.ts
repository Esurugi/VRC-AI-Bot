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
  type GuildBasedChannel,
  type NewsChannel,
  type TextChannel
} from "discord.js";
import type { Logger } from "pino";

import { splitPlainTextReplies } from "../message/replies.js";
import { SessionManager } from "../../codex/session-manager.js";
import {
  SessionPolicyResolver,
  type QuestionGatewayWorkflow
} from "../../codex/session-policy.js";
import { resolvePlaceType } from "../../discord/message-utils.js";
import { hasPlaceFeature } from "../../domain/place-features.js";
import type { AppConfig, WatchLocationConfig } from "../../domain/types.js";
import { DEFAULT_OVERRIDE_FLAGS, type OverrideFlags } from "../../override/types.js";
import { SqliteStore } from "../../storage/database.js";
import { WeeklyMeetupAnnouncementService } from "../scheduling/weekly-meetup-announcement-service.js";
import { ThreadWorkflowGateway } from "../thread/thread-workflow-gateway.js";
import { WorkflowSwitchRerunService } from "../thread/workflow-switch-rerun-service.js";
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
    private readonly logger: Logger,
    private readonly threadWorkflowGateway: ThreadWorkflowGateway | null = null,
    private readonly workflowSwitchRerunService: WorkflowSwitchRerunService | null = null
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
      interaction.commandName !== "weekly-meetup-test" &&
      interaction.commandName !== "workflow-switch"
    ) {
      return false;
    }

    if (!interaction.inCachedGuild()) {
      await replyToInteraction(interaction, "guild 内でのみ使える command です。");
      return true;
    }

    const actorRole = resolveInteractionActorRole(
      interaction,
      this.config.discordOwnerUserIds
    );

    if (interaction.commandName === "workflow-switch") {
      await this.handleWorkflowSwitch(interaction, actorRole);
      return true;
    }

    if (actorRole === "user") {
      await replyToInteraction(
        interaction,
        "Administrator 権限を持つ owner/admin だけがこの command を使えます。"
      );
      return true;
    }

    if (interaction.commandName === "weekly-meetup-test") {
      const watchLocation = resolveCommandWatchLocation(
        interaction.channel,
        this.config.watchLocations
      );
      if (!isAdminControlRootPlace(interaction.channel, watchLocation)) {
        await replyToInteraction(
          interaction,
          "この command は configured `admin_override` root channel でのみ使えます。"
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
      const adminWatchLocation = findAdminControlWatchLocation(
        this.config.watchLocations,
        interaction.guildId
      );
      if (!adminWatchLocation) {
        await replyToInteraction(
          interaction,
          "この guild には override thread 作成先の configured `admin_override` root channel がありません。"
        );
        return true;
      }

      const adminRootChannel = await this.client.channels.fetch(adminWatchLocation.channelId);
      if (!isBaseWatchChannel(adminRootChannel)) {
        await replyToInteraction(
          interaction,
          "override thread の作成先は text/announcement の `admin_override` root channel である必要があります。"
        );
        return true;
      }

      const startedAt = new Date().toISOString();
      const flags = readOverrideFlags(interaction);
      const initialPrompt = interaction.options.getString("prompt")?.trim() ?? "";
      const originWatchLocation = resolveCommandWatchLocation(
        interaction.channel,
        this.config.watchLocations
      );
      if (!canStartOverrideFromOrigin(interaction.channel, originWatchLocation)) {
        await replyToInteraction(
          interaction,
          "この command は configured watch location からのみ使えます。"
        );
        return true;
      }

      const effectiveContentOverride =
        initialPrompt.length > 0 && interaction.channel
          ? await this.overrideBootstrapPromptContextService.buildEffectivePrompt({
              prompt: initialPrompt,
              origin: buildCommandOriginContext(interaction, originWatchLocation),
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

  private async handleWorkflowSwitch(
    interaction: ChatInputCommandInteraction<"cached">,
    actorRole: "owner" | "admin" | "user"
  ): Promise<void> {
    if (!this.threadWorkflowGateway) {
      await replyToInteraction(
        interaction,
        "workflow 切り替え機能が初期化されていません。",
        { ephemeral: true }
      );
      return;
    }

    if (!interaction.channel?.isThread()) {
      await replyToInteraction(
        interaction,
        "この command は question gateway thread 内でのみ使えます。",
        { ephemeral: true }
      );
      return;
    }

    const watchLocation = resolveThreadParentWatchLocation(
      interaction.channel,
      this.config.watchLocations,
      interaction.guildId
    );
    if (
      !watchLocation ||
      watchLocation.guildId !== interaction.guildId ||
      !hasPlaceFeature(watchLocation, "question_gateway")
    ) {
      await replyToInteraction(
        interaction,
        "この command は configured `question_gateway` thread 内でのみ使えます。",
        { ephemeral: true }
      );
      return;
    }

    const route = this.store.threadWorkflowRoutes.get(interaction.channelId);
    if (!route) {
      await replyToInteraction(
        interaction,
        "この thread の workflow route が保存されていないため、切り替えできません。",
        { ephemeral: true }
      );
      return;
    }

    if (actorRole === "user") {
      const starterActorId = await fetchThreadStarterActorId(interaction.channel);
      if (starterActorId !== interaction.user.id) {
        await replyToInteraction(
          interaction,
          "この command は thread starter または owner/admin だけが使えます。",
          { ephemeral: true }
        );
        return;
      }
    }

    const workflow = interaction.options.getString("workflow", true);
    const reason = interaction.options.getString("reason")?.trim() || null;
    const result = this.threadWorkflowGateway.switchWorkflow({
      threadId: interaction.channelId,
      rootChannelId: route.root_channel_id,
      firstMessageId: route.first_message_id,
      workflow,
      actorId: interaction.user.id,
      reason
    });

    if (!result.ok) {
      await replyToInteraction(
        interaction,
        "指定された workflow は許可されていません。",
        { ephemeral: true }
      );
      return;
    }

    const rerun = this.workflowSwitchRerunService?.requestRerun(interaction.channelId) ?? {
      requested: false,
      enqueued: false,
      messageId: null
    };
    const interruptedActiveTurn = await this.interruptQuestionGatewayWorkflowSessions({
      threadId: interaction.channelId,
      previousWorkflow: route.workflow,
      nextWorkflow: result.workflow
    });

    await replyToInteraction(
      interaction,
      rerun.enqueued
        ? `この thread の workflow を \`${result.workflow}\` に切り替え、処理中の応答を中断して再実行します。`
        : interruptedActiveTurn
          ? `この thread の workflow を \`${result.workflow}\` に切り替え、処理中の応答を中断しました。`
          : `この thread の workflow を \`${result.workflow}\` に切り替えました。`,
      { ephemeral: true }
    );
  }

  private async interruptQuestionGatewayWorkflowSessions(input: {
    threadId: string;
    previousWorkflow: QuestionGatewayWorkflow;
    nextWorkflow: QuestionGatewayWorkflow;
  }): Promise<boolean> {
    let interrupted = false;
    const workflows = new Set<QuestionGatewayWorkflow>([
      input.previousWorkflow,
      input.nextWorkflow
    ]);

    for (const workflow of workflows) {
      const identity = this.sessionPolicyResolver.resolveQuestionGatewayWorkflowThread({
        threadId: input.threadId,
        workflow
      });
      try {
        const result = await this.sessionManager.interruptActiveSession(identity);
        interrupted ||= result.interrupted;
      } catch (error) {
        this.logger.warn(
          {
            error: error instanceof Error ? error.message : String(error),
            threadId: input.threadId,
            workflow
          },
          "failed to interrupt active workflow turn after workflow switch"
        );
      }
    }

    return interrupted;
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
      .toJSON(),
    new SlashCommandBuilder()
      .setName("workflow-switch")
      .setDescription("Switch the workflow for an initialized question gateway thread")
      .addStringOption((option) =>
        option
          .setName("workflow")
          .setDescription("Workflow to use for this thread")
          .setRequired(true)
          .addChoices(
            {
              name: "clear_explanation",
              value: "clear_explanation"
            },
            {
              name: "forum_research",
              value: "forum_research"
            }
          )
      )
      .addStringOption((option) =>
        option
          .setName("reason")
          .setDescription("Optional reason for the workflow switch")
          .setRequired(false)
      )
      .toJSON()
  ];
}

function findAdminControlWatchLocation(
  watchLocations: WatchLocationConfig[],
  guildId: string
): WatchLocationConfig | null {
  return (
    watchLocations.find(
      (location) =>
        location.guildId === guildId && hasPlaceFeature(location, "admin_override")
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

function resolveThreadParentWatchLocation(
  thread: AnyThreadChannel,
  watchLocations: WatchLocationConfig[],
  guildId: string
): WatchLocationConfig | null {
  if (!thread.parentId) {
    return null;
  }

  return (
    watchLocations.find(
      (location) =>
        location.guildId === guildId && location.channelId === thread.parentId
    ) ?? null
  );
}

function isAdminControlRootPlace(
  channel: Channel | null,
  watchLocation: WatchLocationConfig | null
): boolean {
  return Boolean(
    channel &&
      !channel.isThread() &&
      watchLocation &&
      hasPlaceFeature(watchLocation, "admin_override") &&
      watchLocation.channelId === channel.id
  );
}

export function canStartOverrideFromOrigin(
  channel: Channel | null,
  watchLocation: WatchLocationConfig | null
): boolean {
  return Boolean(channel && watchLocation);
}

function buildCommandOriginContext(
  interaction: ChatInputCommandInteraction,
  watchLocation: WatchLocationConfig | null
): {
  guildId: string;
  channelId: string;
  rootChannelId: string;
  threadId: string | null;
  mode: WatchLocationConfig["mode"] | "unconfigured";
  placeType: ReturnType<typeof resolvePlaceType>;
} {
  if (!interaction.channel || !interaction.inCachedGuild()) {
    throw new Error("override command origin context requires a cached guild channel");
  }

  const rootChannelId = interaction.channel.isThread()
    ? (interaction.channel.parentId ?? interaction.channelId)
    : interaction.channelId;

  return {
    guildId: interaction.guildId,
    channelId: interaction.channelId,
    rootChannelId,
    threadId: interaction.channel.isThread() ? interaction.channelId : null,
    mode: watchLocation?.mode ?? "unconfigured",
    placeType: resolveCommandOriginPlaceType(interaction.channel, watchLocation)
  };
}

function resolveCommandOriginPlaceType(
  channel: GuildBasedChannel,
  watchLocation: WatchLocationConfig | null
): ReturnType<typeof resolvePlaceType> {
  if (watchLocation) {
    return resolvePlaceType(channel, watchLocation);
  }

  if (channel.isThread()) {
    return channel.type === ChannelType.PrivateThread ? "private_thread" : "public_thread";
  }

  if (channel.type === ChannelType.GuildAnnouncement) {
    return "guild_announcement";
  }

  return "guild_text";
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
  content: string,
  options: { ephemeral?: boolean } = {}
): Promise<void> {
  const payload =
    options.ephemeral === undefined
      ? {
          content,
          allowedMentions: { parse: [] }
        }
      : {
          content,
          ephemeral: options.ephemeral,
          allowedMentions: { parse: [] }
        };

  if (interaction.replied || interaction.deferred) {
    await interaction.followUp(payload);
    return;
  }

  await interaction.reply(payload);
}

async function fetchThreadStarterActorId(thread: AnyThreadChannel): Promise<string | null> {
  if (typeof thread.fetchStarterMessage !== "function") {
    return null;
  }

  const starter = await thread.fetchStarterMessage().catch(() => null);
  return starter?.author.id ?? null;
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
