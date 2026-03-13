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

type WeeklyMeetupAnnouncementDependencies = {
  fetchChannel?: (channelId: string) => Promise<Channel | null>;
  readTemplateFile?: (path: string, encoding: BufferEncoding) => string;
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

    const existing = this._store.scheduledDeliveries.get(
      WEEKLY_MEETUP_EVENT_KEY,
      window.occurrenceDate
    );
    if (existing) {
      this._logger?.debug?.(
        { occurrenceDate: window.occurrenceDate },
        "weekly meetup announcement already delivered"
      );
      return;
    }

    if (!this.fetchChannel) {
      this._logger?.warn?.(
        { channelId: config.channelId },
        "weekly meetup announcement channel fetch is not configured"
      );
      return;
    }

    const channel = await this.fetchChannel(config.channelId);
    if (!isAnnouncementChannel(channel)) {
      this._logger?.warn?.(
        { channelId: config.channelId },
        "weekly meetup announcement channel is not a guild text/announcement channel"
      );
      return;
    }

    let embed: EmbedBuilder;
    try {
      const template = JSON.parse(
        this.readTemplateFile(config.embedTemplatePath, "utf8")
      ) as APIEmbed;
      embed = EmbedBuilder.from(template);
    } catch (error) {
      this._logger?.warn?.(
        { error, path: config.embedTemplatePath },
        "failed to read weekly meetup embed template"
      );
      return;
    }

    const sent = await channel.send({
      embeds: [embed]
    });

    this._store.scheduledDeliveries.markDelivered({
      eventKey: WEEKLY_MEETUP_EVENT_KEY,
      occurrenceDate: window.occurrenceDate,
      deliveredAt: nowJst.toISOString(),
      channelId: channel.id,
      messageId: sent.id ?? null
    });

    this._logger?.debug?.(
      {
        occurrenceDate: window.occurrenceDate,
        channelId: channel.id,
        messageId: sent.id ?? null
      },
      "weekly meetup announcement delivered"
    );
  }
}

function resolveAnnouncementWindow(now: Date): {
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
