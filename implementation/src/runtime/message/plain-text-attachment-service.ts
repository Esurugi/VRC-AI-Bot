import type { Message } from "discord.js";
import type { Logger } from "pino";

import { isReadableTextAttachment } from "../../discord/message-utils.js";

const MAX_PLAIN_TEXT_ATTACHMENT_BYTES = 256 * 1024;
const ATTACHMENT_FETCH_TIMEOUT_MS = 10_000;

export class PlainTextAttachmentService {
  constructor(private readonly logger: Pick<Logger, "warn">) {}

  async buildEffectiveContent(message: Message<true>): Promise<string | null> {
    const baseContent = message.content.trim();
    const attachmentSections: string[] = [];

    for (const attachment of message.attachments.values()) {
      if (!isReadableTextAttachment(attachment)) {
        continue;
      }

      if (attachment.size > MAX_PLAIN_TEXT_ATTACHMENT_BYTES) {
        this.logger.warn(
          {
            messageId: message.id,
            attachmentId: attachment.id,
            attachmentName: attachment.name,
            attachmentSize: attachment.size
          },
          "skipping oversized plain-text attachment"
        );
        continue;
      }

      try {
        const response = await fetch(attachment.url, {
          signal: AbortSignal.timeout(ATTACHMENT_FETCH_TIMEOUT_MS)
        });
        if (!response.ok) {
          throw new Error(`attachment fetch failed with ${response.status}`);
        }

        const text = normalizePlainText(await response.text());
        if (!text) {
          continue;
        }

        attachmentSections.push(
          `Attached text file (${attachment.name ?? "unnamed.txt"}):\n${text}`
        );
      } catch (error) {
        this.logger.warn(
          {
            error: error instanceof Error ? error.message : String(error),
            messageId: message.id,
            attachmentId: attachment.id,
            attachmentName: attachment.name
          },
          "failed to read plain-text attachment"
        );
      }
    }

    if (attachmentSections.length === 0) {
      return baseContent.length > 0 ? baseContent : null;
    }

    if (baseContent.length === 0) {
      return attachmentSections.join("\n\n");
    }

    return [baseContent, ...attachmentSections].join("\n\n");
  }
}

function normalizePlainText(input: string): string | null {
  const normalized = input.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").trim();
  return normalized.length > 0 ? normalized : null;
}
