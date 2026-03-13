import type { SqliteStore } from "../../storage/database.js";

export class ChatChannelCounterService {
  constructor(private readonly store: SqliteStore) {}

  get(channelId: string) {
    return this.store.chatChannelCounters?.get(channelId) ?? null;
  }

  increment(channelId: string) {
    return this.store.chatChannelCounters?.increment(channelId) ?? null;
  }

  resetAll() {
    this.store.chatChannelCounters?.resetAll();
  }
}
