import {
  AttachmentBuilder,
  type AnyThreadChannel,
  type GuildTextBasedChannel
} from "discord.js";

import type { GeneratedImageArtifact } from "../../codex/app-server-client.js";
import { appendRuntimeTrace } from "../../observability/runtime-trace.js";
import type { QueuedMessage } from "../types.js";
import { buildPlainTextReply, splitPlainTextReplies } from "./replies.js";

type StreamingMessage = {
  edit: (input: {
    content: string;
    allowedMentions: { parse: [] };
  }) => Promise<unknown>;
};

export class DiscordReplySender {
  async sendChunksToChannel(
    channel: AnyThreadChannel,
    content: string
  ): Promise<void> {
    for (const chunk of splitPlainTextReplies(content)) {
      await channel.send({
        content: chunk,
        allowedMentions: {
          parse: []
        }
      });
    }
  }

  async replyInSamePlace(item: QueuedMessage, content: string): Promise<void> {
    const chunks = splitPlainTextReplies(content);
    const [firstChunk, ...restChunks] = chunks;
    await item.message.reply({
      content: firstChunk ?? buildPlainTextReply(content),
      allowedMentions: {
        repliedUser: false
      }
    });
    for (const chunk of restChunks) {
      await item.message.channel.send({
        content: chunk,
        allowedMentions: {
          parse: []
        }
      });
    }
    appendRuntimeTrace("codex-app-server", "discord_reply_sent", {
      messageId: item.envelope.messageId,
      channelId: item.envelope.channelId,
      watchMode: item.watchLocation.mode,
      chunkCount: chunks.length,
      firstChunkLength: (firstChunk ?? "").length
    });
  }

  async sendFollowupInSamePlace(
    item: QueuedMessage,
    content: string
  ): Promise<void> {
    const chunks = splitPlainTextReplies(content);
    for (const chunk of chunks) {
      await item.message.channel.send({
        content: chunk,
        allowedMentions: {
          parse: []
        }
      });
    }
    appendRuntimeTrace("codex-app-server", "discord_followup_sent", {
      messageId: item.envelope.messageId,
      channelId: item.envelope.channelId,
      watchMode: item.watchLocation.mode,
      chunkCount: chunks.length
    });
  }

  async sendGeneratedImagesInSamePlace(
    item: QueuedMessage,
    images: GeneratedImageArtifact[]
  ): Promise<void> {
    await this.sendGeneratedImagesToChannel(item.message.channel, images);
  }

  async sendGeneratedImagesToChannel(
    channel: GuildTextBasedChannel,
    images: GeneratedImageArtifact[]
  ): Promise<void> {
    if (images.length === 0) {
      return;
    }

    const files = images.map(
      (image) =>
        new AttachmentBuilder(Buffer.from(image.data_base64, "base64"), {
          name: image.filename
        })
    );
    await channel.send({
      files,
      allowedMentions: {
        parse: []
      }
    });
  }

  async createStreamingReplyInSamePlace(item: QueuedMessage): Promise<{
    append: (delta: string) => Promise<void>;
    complete: () => Promise<void>;
  }> {
    const sentMessages: StreamingMessage[] = [];
    const sentContents: string[] = [];
    let accumulated = "";
    let flushPromise = Promise.resolve();
    let flushTimer: NodeJS.Timeout | null = null;

    const flushNow = async (): Promise<void> => {
      const chunks = splitPlainTextReplies(accumulated || " ");
      for (let index = 0; index < chunks.length; index += 1) {
        const chunk = chunks[index] ?? "";
        if (sentMessages[index]) {
          if (sentContents[index] === chunk) {
            continue;
          }
          await sentMessages[index]?.edit({
            content: chunk,
            allowedMentions: { parse: [] }
          });
          sentContents[index] = chunk;
          continue;
        }

        const message = await item.message.channel.send({
          content: chunk,
          allowedMentions: {
            parse: []
          }
        });
        sentMessages.push(message);
        sentContents.push(chunk);
      }
    };

    const scheduleFlush = (): void => {
      if (flushTimer) {
        return;
      }

      flushTimer = setTimeout(() => {
        flushTimer = null;
        flushPromise = flushPromise.then(() => flushNow());
      }, 300);
    };

    return {
      append: async (delta: string) => {
        accumulated += delta;
        scheduleFlush();
      },
      complete: async () => {
        if (flushTimer) {
          clearTimeout(flushTimer);
          flushTimer = null;
        }
        flushPromise = flushPromise.then(() => flushNow());
        await flushPromise;
      }
    };
  }
}
