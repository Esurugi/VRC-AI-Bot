import { readFileSync } from "node:fs";

import {
  ChannelType,
  EmbedBuilder,
  type APIEmbed,
  type Channel,
  type NewsChannel,
  type TextChannel
} from "discord.js";
import type { Logger } from "pino";

import type { AppConfig } from "../../domain/types.js";
import type { SqliteStore } from "../../storage/database.js";

const WEEKLY_MEETUP_EVENT_KEY = "weekly_meetup";
const JST_TIME_ZONE = "Asia/Tokyo";
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const TEST_MARKER = "[TEST]";

type WeeklyMeetupAnnouncementDependencies = {
  fetchChannel?: (channelId: string) => Promise<Channel | null>;
  readTemplateFile?: (path: string, encoding: BufferEncoding) => string;
};

type AnnouncementSendFailureReason =
  | "not_configured"
  | "channel_fetch_not_configured"
  | "invalid_channel"
  | "template_read_failed"
  | "send_failed";

type AnnouncementSendResult =
  | {
      kind: "sent";
      channelId: string;
      messageId: string | null;
      occurrenceDate: string | null;
    }
  | {
      kind: "skipped";
      reason: "outside_window" | "already_delivered";
      occurrenceDate: string;
    }
  | {
      kind: "failed";
      reason: AnnouncementSendFailureReason;
      detail?: string;
    };

export type WeeklyMeetupTestAnnouncementResult =
  | {
      ok: true;
      channelId: string;
      messageId: string | null;
    }
  | {
      ok: false;
      reason: AnnouncementSendFailureReason;
      detail?: string;
    };

export class WeeklyMeetupAnnouncementService {
  private readonly fetchChannel: ((channelId: string) => Promise<Channel | null>) | null;
  private readonly readTemplateFile: (
    path: string,
    encoding: BufferEncoding
  ) => string;

  constructor(
    private readonly _config: AppConfig,
    private readonly _store: SqliteStore,
    private readonly _logger?: Pick<Logger, "debug" | "warn">,
    dependencies: WeeklyMeetupAnnouncementDependencies = {}
  ) {
    this.fetchChannel = dependencies.fetchChannel ?? null;
    this.readTemplateFile = dependencies.readTemplateFile ?? readFileSync;
  }

  async poll(nowJst = new Date()): Promise<void> {
    const config = this._config.weeklyMeetupAnnouncement;
    if (!config) {
      return;
    }

    const window = resolveAnnouncementWindow(nowJst);
    if (!window.shouldSend) {
      return;
    }

    const result = await this.sendAnnouncement({
      now: nowJst,
      channelId: config.channelId,
      occurrenceDate: window.occurrenceDate,
      markDelivered: true,
      testMarker: false
    });

    if (result.kind === "skipped" && result.reason === "already_delivered") {
      this._logger?.debug?.(
        { occurrenceDate: result.occurrenceDate },
        "weekly meetup announcement already delivered"
      );
      return;
    }

    if (result.kind === "failed") {
      this._logger?.warn?.(
        buildFailureLogPayload(config.channelId, result),
        buildFailureLogMessage(result.reason)
      );
      return;
    }

    if (result.kind === "sent") {
      this._logger?.debug?.(
        {
          occurrenceDate: result.occurrenceDate,
          channelId: result.channelId,
          messageId: result.messageId
        },
        "weekly meetup announcement delivered"
      );
    }
  }

  async sendTestAnnouncement(now = new Date()): Promise<WeeklyMeetupTestAnnouncementResult> {
    const config = this._config.weeklyMeetupAnnouncement;
    if (!config) {
      return {
        ok: false,
        reason: "not_configured"
      };
    }

    const result = await this.sendAnnouncement({
      now,
      channelId: config.channelId,
      occurrenceDate: null,
      markDelivered: false,
      testMarker: true
    });

    if (result.kind === "sent") {
      this._logger?.debug?.(
        {
          channelId: result.channelId,
          messageId: result.messageId
        },
        "weekly meetup test announcement delivered"
      );
      return {
        ok: true,
        channelId: result.channelId,
        messageId: result.messageId
      };
    }

    if (result.kind === "failed") {
      this._logger?.warn?.(
        buildFailureLogPayload(config.channelId, result),
        `failed to deliver weekly meetup test announcement (${result.reason})`
      );
      return {
        ok: false,
        reason: result.reason,
        ...(result.detail ? { detail: result.detail } : {})
      };
    }

    return {
      ok: false,
      reason: "send_failed",
      detail: `unexpected test announcement result: ${result.reason}`
    };
  }

  private async sendAnnouncement(input: {
    now: Date;
    channelId: string;
    occurrenceDate: string | null;
    markDelivered: boolean;
    testMarker: boolean;
  }): Promise<AnnouncementSendResult> {
    if (!this.fetchChannel) {
      return {
        kind: "failed",
        reason: "channel_fetch_not_configured"
      };
    }

    if (input.markDelivered && input.occurrenceDate) {
      const existing = this._store.scheduledDeliveries.get(
        WEEKLY_MEETUP_EVENT_KEY,
        input.occurrenceDate
      );
      if (existing) {
        return {
          kind: "skipped",
          reason: "already_delivered",
          occurrenceDate: input.occurrenceDate
        };
      }
    }

    const channel = await this.fetchChannel(input.channelId);
    if (!isAnnouncementChannel(channel)) {
      return {
        kind: "failed",
        reason: "invalid_channel"
      };
    }

    let embed: EmbedBuilder;
    try {
      embed = this.readEmbedTemplate(input.testMarker);
    } catch (error) {
      return {
        kind: "failed",
        reason: "template_read_failed",
        detail: error instanceof Error ? error.message : String(error)
      };
    }

    try {
      const sent = await channel.send({
        embeds: [embed]
      });

      if (input.markDelivered && input.occurrenceDate) {
        this._store.scheduledDeliveries.markDelivered({
          eventKey: WEEKLY_MEETUP_EVENT_KEY,
          occurrenceDate: input.occurrenceDate,
          deliveredAt: input.now.toISOString(),
          channelId: channel.id,
          messageId: sent.id ?? null
        });
      }

      return {
        kind: "sent",
        channelId: channel.id,
        messageId: sent.id ?? null,
        occurrenceDate: input.occurrenceDate
      };
    } catch (error) {
      return {
        kind: "failed",
        reason: "send_failed",
        detail: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private readEmbedTemplate(testMarker: boolean): EmbedBuilder {
    const config = this._config.weeklyMeetupAnnouncement;
    if (!config) {
      throw new Error("weekly_meetup_announcement is not configured");
    }

    const template = JSON.parse(
      this.readTemplateFile(config.embedTemplatePath, "utf8")
    ) as APIEmbed;
    const resolvedTemplate = testMarker ? appendTestMarker(template) : template;
    return EmbedBuilder.from(resolvedTemplate);
  }
}

export function resolveAnnouncementWindow(now: Date): {
  shouldSend: boolean;
  occurrenceDate: string;
} {
  const parts = getJstDateParts(now);
  const occurrenceDate = `${parts.year}-${parts.month}-${parts.day}`;
  const isMonday = parts.weekday === "Mon";
  const hour = Number(parts.hour);

  return {
    shouldSend: isMonday && hour >= 18 && hour < 21,
    occurrenceDate
  };
}

export function resolveNextWeeklyMeetupAnnouncementAt(now: Date): Date {
  const nowJst = new Date(now.getTime() + JST_OFFSET_MS);
  const dayDiff = (1 - nowJst.getUTCDay() + 7) % 7;
  let targetJstMs = Date.UTC(
    nowJst.getUTCFullYear(),
    nowJst.getUTCMonth(),
    nowJst.getUTCDate() + dayDiff,
    18,
    0,
    0,
    0
  );

  if (targetJstMs <= nowJst.getTime()) {
    targetJstMs = Date.UTC(
      nowJst.getUTCFullYear(),
      nowJst.getUTCMonth(),
      nowJst.getUTCDate() + dayDiff + 7,
      18,
      0,
      0,
      0
    );
  }

  return new Date(targetJstMs - JST_OFFSET_MS);
}

function getJstDateParts(now: Date): Record<
  "weekday" | "year" | "month" | "day" | "hour",
  string
> {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: JST_TIME_ZONE,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false
  });
  const formatted = formatter.formatToParts(now);
  const lookup = new Map(formatted.map((part) => [part.type, part.value]));

  return {
    weekday: lookup.get("weekday") ?? "",
    year: lookup.get("year") ?? "",
    month: lookup.get("month") ?? "",
    day: lookup.get("day") ?? "",
    hour: lookup.get("hour") ?? ""
  };
}

function appendTestMarker(template: APIEmbed): APIEmbed {
  const footerText = template.footer?.text
    ? `${template.footer.text} ${TEST_MARKER}`
    : TEST_MARKER;

  return {
    ...template,
    footer: {
      ...template.footer,
      text: footerText
    }
  };
}

function buildFailureLogPayload(
  channelId: string,
  result: Extract<AnnouncementSendResult, { kind: "failed" }>
): Record<string, unknown> {
  return {
    channelId,
    ...(result.detail ? { detail: result.detail } : {})
  };
}

function buildFailureLogMessage(reason: AnnouncementSendFailureReason): string {
  switch (reason) {
    case "channel_fetch_not_configured":
      return "weekly meetup announcement channel fetch is not configured";
    case "invalid_channel":
      return "weekly meetup announcement channel is not a guild text/announcement channel";
    case "template_read_failed":
      return "failed to read weekly meetup embed template";
    case "send_failed":
      return "failed to send weekly meetup announcement";
    case "not_configured":
      return "weekly meetup announcement is not configured";
  }
}

function isAnnouncementChannel(
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
