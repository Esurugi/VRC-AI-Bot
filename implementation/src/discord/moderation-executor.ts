import { PermissionFlagsBits, type Client, type Guild, type GuildMember } from "discord.js";
import type { Logger } from "pino";

export type ModerationFailureReason =
  | "missing_permission"
  | "hierarchy_blocked"
  | "member_not_found"
  | "discord_api_error";

export type ModerationAction = "timeout" | "kick";

export type ModerationActionResult =
  | {
      ok: true;
      action: ModerationAction;
      deliveryStatus: "applied";
    }
  | {
      ok: false;
      action: ModerationAction;
      deliveryStatus: "failed";
      failureReason: ModerationFailureReason;
      message: string;
    };

export interface ModerationExecutor {
  timeoutMember(
    guildId: string,
    userId: string,
    durationMs: number,
    reason: string
  ): Promise<ModerationActionResult>;
  kickMember(
    guildId: string,
    userId: string,
    reason: string
  ): Promise<ModerationActionResult>;
}

export class DiscordModerationExecutor implements ModerationExecutor {
  constructor(
    private readonly client: Pick<Client, "guilds">,
    private readonly logger?: Pick<Logger, "warn">
  ) {}

  async timeoutMember(
    guildId: string,
    userId: string,
    durationMs: number,
    reason: string
  ): Promise<ModerationActionResult> {
    const guild = await this.fetchGuild(guildId, "timeout");
    if (!guild.ok) {
      return guild.result;
    }

    const me = await this.resolveBotMember(guild.value, "timeout");
    if (!me.ok) {
      return me.result;
    }

    if (!me.value.permissions.has(PermissionFlagsBits.ModerateMembers)) {
      return failure("timeout", "missing_permission", "missing MODERATE_MEMBERS permission");
    }

    const member = await this.fetchTargetMember(guild.value, userId, "timeout");
    if (!member.ok) {
      return member.result;
    }

    if (!member.value.moderatable) {
      return failure("timeout", "hierarchy_blocked", "target member is not moderatable");
    }

    try {
      await member.value.timeout(durationMs, reason);
      return success("timeout");
    } catch (error) {
      this.logger?.warn?.(
        {
          guildId,
          userId,
          durationMs,
          error: error instanceof Error ? error.message : String(error)
        },
        "failed to timeout discord member"
      );
      return failure(
        "timeout",
        classifyDiscordFailure(error),
        error instanceof Error ? error.message : "discord_api_error"
      );
    }
  }

  async kickMember(
    guildId: string,
    userId: string,
    reason: string
  ): Promise<ModerationActionResult> {
    const guild = await this.fetchGuild(guildId, "kick");
    if (!guild.ok) {
      return guild.result;
    }

    const me = await this.resolveBotMember(guild.value, "kick");
    if (!me.ok) {
      return me.result;
    }

    if (!me.value.permissions.has(PermissionFlagsBits.KickMembers)) {
      return failure("kick", "missing_permission", "missing KICK_MEMBERS permission");
    }

    const member = await this.fetchTargetMember(guild.value, userId, "kick");
    if (!member.ok) {
      return member.result;
    }

    if (!member.value.kickable) {
      return failure("kick", "hierarchy_blocked", "target member is not kickable");
    }

    try {
      await member.value.kick(reason);
      return success("kick");
    } catch (error) {
      this.logger?.warn?.(
        {
          guildId,
          userId,
          error: error instanceof Error ? error.message : String(error)
        },
        "failed to kick discord member"
      );
      return failure(
        "kick",
        classifyDiscordFailure(error),
        error instanceof Error ? error.message : "discord_api_error"
      );
    }
  }

  private async fetchGuild(
    guildId: string,
    action: ModerationAction
  ): Promise<
    | { ok: true; value: Guild }
    | { ok: false; result: ModerationActionResult }
  > {
    try {
      const guild = await this.client.guilds.fetch(guildId);
      return { ok: true, value: guild };
    } catch (error) {
      this.logger?.warn?.(
        {
          guildId,
          action,
          error: error instanceof Error ? error.message : String(error)
        },
        "failed to fetch guild for moderation"
      );
      return {
        ok: false,
        result: failure(
          action,
          classifyDiscordFailure(error),
          error instanceof Error ? error.message : "discord_api_error"
        )
      };
    }
  }

  private async resolveBotMember(
    guild: Guild,
    action: ModerationAction
  ): Promise<
    | { ok: true; value: GuildMember }
    | { ok: false; result: ModerationActionResult }
  > {
    if (guild.members.me) {
      return { ok: true, value: guild.members.me };
    }

    if (typeof guild.members.fetchMe !== "function") {
      return {
        ok: false,
        result: failure(action, "discord_api_error", "unable to resolve bot guild member")
      };
    }

    try {
      const me = await guild.members.fetchMe();
      return { ok: true, value: me };
    } catch (error) {
      this.logger?.warn?.(
        {
          guildId: guild.id,
          action,
          error: error instanceof Error ? error.message : String(error)
        },
        "failed to fetch bot member for moderation"
      );
      return {
        ok: false,
        result: failure(
          action,
          classifyDiscordFailure(error),
          error instanceof Error ? error.message : "discord_api_error"
        )
      };
    }
  }

  private async fetchTargetMember(
    guild: Guild,
    userId: string,
    action: ModerationAction
  ): Promise<
    | { ok: true; value: GuildMember }
    | { ok: false; result: ModerationActionResult }
  > {
    try {
      const member = await guild.members.fetch(userId);
      return { ok: true, value: member };
    } catch (error) {
      this.logger?.warn?.(
        {
          guildId: guild.id,
          userId,
          action,
          error: error instanceof Error ? error.message : String(error)
        },
        "failed to fetch target member for moderation"
      );
      return {
        ok: false,
        result: failure(
          action,
          classifyDiscordFailure(error),
          error instanceof Error ? error.message : "discord_api_error"
        )
      };
    }
  }
}

function success(action: ModerationAction): ModerationActionResult {
  return {
    ok: true,
    action,
    deliveryStatus: "applied"
  };
}

function failure(
  action: ModerationAction,
  failureReason: ModerationFailureReason,
  message: string
): ModerationActionResult {
  return {
    ok: false,
    action,
    deliveryStatus: "failed",
    failureReason,
    message
  };
}

function classifyDiscordFailure(error: unknown): ModerationFailureReason {
  if (isMemberNotFoundError(error)) {
    return "member_not_found";
  }

  return "discord_api_error";
}

function isMemberNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const candidate = error as {
    code?: number | string;
    status?: number;
    message?: string;
  };
  return (
    candidate.code === 10007 ||
    candidate.code === "10007" ||
    candidate.status === 404 ||
    candidate.message?.includes("Unknown Member") === true
  );
}
