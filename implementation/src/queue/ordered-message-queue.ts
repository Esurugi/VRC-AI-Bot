export class OrderedMessageQueue<
  T extends {
    messageId: string;
    orderingKey: string;
  }
> {
  private readonly seen = new Map<string, number>();
  private readonly lanes = new Map<string, T[]>();
  private readonly activeKeys = new Set<string>();
  private drainScheduled = false;

  constructor(
    private readonly worker: (item: T) => Promise<void>,
    private readonly maxConcurrentKeys = 4
  ) {}

  enqueue(
    item: T,
    options: {
      allowDuplicateMessageId?: boolean;
    } = {}
  ): boolean {
    if ((this.seen.get(item.messageId) ?? 0) > 0 && !options.allowDuplicateMessageId) {
      return false;
    }

    this.seen.set(item.messageId, (this.seen.get(item.messageId) ?? 0) + 1);
    const lane = this.lanes.get(item.orderingKey) ?? [];
    lane.push(item);
    lane.sort((left, right) =>
      compareDiscordSnowflakes(left.messageId, right.messageId)
    );
    this.lanes.set(item.orderingKey, lane);
    this.scheduleDrain();
    return true;
  }

  get size(): number {
    return [...this.lanes.values()].reduce(
      (count, lane) => count + lane.length,
      0
    );
  }

  private async drain(): Promise<void> {
    while (this.activeKeys.size < this.maxConcurrentKeys) {
      const nextKey = this.selectNextKey();
      if (!nextKey) {
        return;
      }

      this.activeKeys.add(nextKey);
      void this.runLane(nextKey);
    }
  }

  private scheduleDrain(): void {
    if (this.drainScheduled) {
      return;
    }

    this.drainScheduled = true;
    queueMicrotask(() => {
      this.drainScheduled = false;
      void this.drain();
    });
  }

  private selectNextKey(): string | null {
    let selectedKey: string | null = null;
    let selectedItem: T | null = null;

    for (const [key, lane] of this.lanes) {
      const head = lane[0];
      if (!head || this.activeKeys.has(key)) {
        continue;
      }

      if (
        !selectedItem ||
        compareDiscordSnowflakes(head.messageId, selectedItem.messageId) < 0
      ) {
        selectedKey = key;
        selectedItem = head;
      }
    }

    return selectedKey;
  }

  private async runLane(orderingKey: string): Promise<void> {
    try {
      while (true) {
        const lane = this.lanes.get(orderingKey);
        const item = lane?.shift();
        if (!item) {
          this.lanes.delete(orderingKey);
          return;
        }

        try {
          await this.worker(item);
        } catch {
          // The worker is responsible for logging and failure handling.
        } finally {
          this.releaseSeen(item.messageId);
        }
      }
    } finally {
      this.activeKeys.delete(orderingKey);
      if ((this.lanes.get(orderingKey)?.length ?? 0) === 0) {
        this.lanes.delete(orderingKey);
      }
      if (this.size > 0) {
        this.scheduleDrain();
      }
    }
  }

  private releaseSeen(messageId: string): void {
    const count = this.seen.get(messageId) ?? 0;
    if (count <= 1) {
      this.seen.delete(messageId);
      return;
    }

    this.seen.set(messageId, count - 1);
  }
}

function compareDiscordSnowflakes(left: string, right: string): number {
  const leftValue = BigInt(left);
  const rightValue = BigInt(right);

  if (leftValue === rightValue) {
    return 0;
  }

  return leftValue < rightValue ? -1 : 1;
}
