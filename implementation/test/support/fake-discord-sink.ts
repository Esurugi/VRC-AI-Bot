import { Collection, ChannelType, type Message } from "discord.js";

export type FakeDiscordAttachment = {
  name: string | null;
  description: string | null;
  attachment: unknown;
};

export type FakeDiscordEvent =
  | {
      type: "reply";
      channelId: string;
      messageId: string;
      content: string;
      files: FakeDiscordAttachment[];
    }
  | {
      type: "send";
      channelId: string;
      content: string;
      files: FakeDiscordAttachment[];
    }
  | {
      type: "edit";
      channelId: string;
      content: string;
    }
  | {
      type: "createThread";
      channelId: string;
      messageId: string;
      threadId: string;
      name: string;
    }
  | {
      type: "archive";
      channelId: string;
      archived: boolean;
    }
  | {
      type: "typing";
      channelId: string;
    };

export class FakeDiscordSink {
  readonly events: FakeDiscordEvent[] = [];
  private threadOrdinal = 0;

  record(event: FakeDiscordEvent): void {
    this.events.push(event);
  }

  nextThreadId(): string {
    this.threadOrdinal += 1;
    return `thread-${this.threadOrdinal}`;
  }

  sentTexts(): string[] {
    return this.events
      .filter((event) => event.type === "reply" || event.type === "send")
      .map((event) => event.content);
  }

  sentFiles(): FakeDiscordAttachment[] {
    return this.events
      .filter((event) => event.type === "reply" || event.type === "send")
      .flatMap((event) => event.files);
  }
}

export class FakeDiscordWorld {
  readonly sink = new FakeDiscordSink();
  readonly client = {
    user: {
      id: "bot-user"
    }
  };
  readonly guild = {
    id: "guild-1",
    name: "VRChat-AI集会"
  };
  private readonly channels = new Map<string, FakeDiscordChannel>();

  createTextChannel(input: {
    id: string;
    name?: string;
  }): FakeDiscordChannel {
    const channel = new FakeDiscordChannel({
      id: input.id,
      name: input.name ?? input.id,
      sink: this.sink,
      world: this,
      parent: null,
      isThread: false,
      type: ChannelType.GuildText
    });
    this.channels.set(channel.id, channel);
    return channel;
  }

  createThread(input: {
    id: string;
    parent: FakeDiscordChannel;
    name?: string;
    starterContent?: string;
  }): FakeDiscordChannel {
    const thread = new FakeDiscordChannel({
      id: input.id,
      name: input.name ?? input.id,
      sink: this.sink,
      world: this,
      parent: input.parent,
      isThread: true,
      type: ChannelType.PublicThread,
      starterContent: input.starterContent ?? null
    });
    this.channels.set(thread.id, thread);
    return thread;
  }

  getChannel(channelId: string): FakeDiscordChannel | null {
    return this.channels.get(channelId) ?? null;
  }
}

export class FakeDiscordChannel {
  readonly id: string;
  readonly name: string;
  readonly type: ChannelType;
  readonly parent: FakeDiscordChannel | null;
  readonly parentId: string | null;
  readonly archived = false;
  readonly locked = false;
  readonly autoArchiveDuration = 1440;
  readonly messages = {
    fetch: async () => new Collection<string, Message<true>>()
  };
  private readonly sink: FakeDiscordSink;
  private readonly world: FakeDiscordWorld;
  private readonly thread: boolean;
  private readonly starterContent: string | null;

  constructor(input: {
    id: string;
    name: string;
    sink: FakeDiscordSink;
    world: FakeDiscordWorld;
    parent: FakeDiscordChannel | null;
    isThread: boolean;
    type: ChannelType;
    starterContent?: string | null;
  }) {
    this.id = input.id;
    this.name = input.name;
    this.sink = input.sink;
    this.world = input.world;
    this.parent = input.parent;
    this.parentId = input.parent?.id ?? null;
    this.thread = input.isThread;
    this.type = input.type;
    this.starterContent = input.starterContent ?? null;
  }

  isThread(): boolean {
    return this.thread;
  }

  async send(input: string | { content?: string | null; files?: unknown[] }): Promise<{
    edit: (editInput: { content: string }) => Promise<void>;
  }> {
    const content = typeof input === "string" ? input : input.content ?? "";
    const files = typeof input === "string" ? [] : normalizeFiles(input.files);
    this.sink.record({
      type: "send",
      channelId: this.id,
      content,
      files
    });
    return {
      edit: async (editInput) => {
        this.sink.record({
          type: "edit",
          channelId: this.id,
          content: editInput.content
        });
      }
    };
  }

  async sendTyping(): Promise<void> {
    this.sink.record({
      type: "typing",
      channelId: this.id
    });
  }

  async fetchStarterMessage(): Promise<{ id: string; content: string } | null> {
    return this.starterContent === null
      ? null
      : {
          id: "starter-message",
          content: this.starterContent
        };
  }

  createChildThread(input: {
    messageId: string;
    name: string;
  }): FakeDiscordChannel {
    const threadId = this.sink.nextThreadId();
    const thread = this.world.createThread({
      id: threadId,
      parent: this,
      name: input.name
    });
    this.sink.record({
      type: "createThread",
      channelId: this.id,
      messageId: input.messageId,
      threadId,
      name: input.name
    });
    return thread;
  }

  async setArchived(archived: boolean): Promise<void> {
    this.sink.record({
      type: "archive",
      channelId: this.id,
      archived
    });
  }
}

export function createFakeMessage(input: {
  id: string;
  channel: FakeDiscordChannel;
  world: FakeDiscordWorld;
  content: string;
  authorId?: string;
  urls?: string[];
  mentionsBot?: boolean;
  replyToBot?: boolean;
}): Message<true> {
  const authorId = input.authorId ?? "user-1";
  const message = {
    id: input.id,
    channelId: input.channel.id,
    guildId: input.world.guild.id,
    guild: input.world.guild,
    channel: input.channel,
    content: input.content,
    url: `https://discord.test/channels/${input.world.guild.id}/${input.channel.id}/${input.id}`,
    createdAt: new Date("2026-05-21T00:00:00.000Z"),
    client: input.world.client,
    author: {
      id: authorId,
      bot: false,
      username: "user",
      displayName: "user",
      globalName: "user"
    },
    member: {
      displayName: "user"
    },
    webhookId: null,
    system: false,
    mentions: {
      users: {
        has: (userId: string) =>
          input.mentionsBot === true && userId === input.world.client.user.id
      },
      repliedUser:
        input.replyToBot === true
          ? {
              id: input.world.client.user.id
            }
          : null
    },
    reference:
      input.replyToBot === true
        ? {
            messageId: "bot-message"
          }
        : null,
    fetchReference: async () =>
      input.replyToBot === true
        ? {
            author: {
              id: input.world.client.user.id
            }
          }
        : null,
    reply: async (replyInput: { content?: string | null; files?: unknown[] }) => {
      input.world.sink.record({
        type: "reply",
        channelId: input.channel.id,
        messageId: input.id,
        content: replyInput.content ?? "",
        files: normalizeFiles(replyInput.files)
      });
    },
    startThread: async (threadInput: { name: string }) =>
      input.channel.createChildThread({
        messageId: input.id,
        name: threadInput.name
      })
  };

  void input.urls;
  return message as unknown as Message<true>;
}

function normalizeFiles(files: unknown[] | undefined): FakeDiscordAttachment[] {
  return (files ?? []).map((file) => {
    if (typeof file === "object" && file !== null) {
      const candidate = file as {
        name?: unknown;
        description?: unknown;
        attachment?: unknown;
      };
      return {
        name: typeof candidate.name === "string" ? candidate.name : null,
        description:
          typeof candidate.description === "string"
            ? candidate.description
            : null,
        attachment:
          "attachment" in candidate ? candidate.attachment : candidate
      };
    }

    return {
      name: null,
      description: null,
      attachment: file
    };
  });
}
