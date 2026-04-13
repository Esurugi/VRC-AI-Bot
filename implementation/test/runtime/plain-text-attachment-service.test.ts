import test from "node:test";
import assert from "node:assert/strict";

import { PlainTextAttachmentService } from "../../src/runtime/message/plain-text-attachment-service.js";

test("plain-text attachment service appends txt attachment content to the message", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    ({
      ok: true,
      text: async () => "1行目\r\n2行目",
      status: 200
    }) as Response) as typeof fetch;

  try {
    const service = new PlainTextAttachmentService({
      warn: () => undefined
    });

    const effectiveContent = await service.buildEffectiveContent(
      createMessage({
        content: "この内容を読んで",
        attachments: [
          {
            id: "a1",
            name: "context.txt",
            contentType: "text/plain",
            size: 64,
            url: "https://cdn.example.com/context.txt"
          }
        ]
      })
    );

    assert.equal(
      effectiveContent,
      "この内容を読んで\n\nAttached text file (context.txt):\n1行目\n2行目"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("plain-text attachment service returns attachment text even when message body is empty", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    ({
      ok: true,
      text: async () => "https://example.com/post",
      status: 200
    }) as Response) as typeof fetch;

  try {
    const service = new PlainTextAttachmentService({
      warn: () => undefined
    });

    const effectiveContent = await service.buildEffectiveContent(
      createMessage({
        content: "",
        attachments: [
          {
            id: "a1",
            name: "links.txt",
            contentType: "text/plain; charset=utf-8",
            size: 64,
            url: "https://cdn.example.com/links.txt"
          }
        ]
      })
    );

    assert.equal(
      effectiveContent,
      "Attached text file (links.txt):\nhttps://example.com/post"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function createMessage(input: {
  content: string;
  attachments: Array<{
    id: string;
    name: string;
    contentType: string | null;
    size: number;
    url: string;
  }>;
}) {
  return {
    id: "message-1",
    content: input.content,
    attachments: new Map(
      input.attachments.map((attachment) => [
        attachment.id,
        {
          ...attachment
        }
      ])
    )
  } as never;
}
