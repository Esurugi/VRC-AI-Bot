export class OrderedMessageQueue<
  T extends {
    messageId: string;
    orderingKey: string;
  }
> {
  private readonly seen = new Set<string>();
  private readonly lanes = new Map<string, T[]>();
  private readonly activeKeys = new Set<string>();
  private drainScheduled = false;

  constructor(
    private readonly worker: (item: T) => Promise<void>,
    private readonly maxConcurrentKeys = 4
  ) {}

  enqueue(item: T): boolean {
    if (this.seen.has(item.messageId)) {
      return false;
    }

    this.seen.add(item.messageId);
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
}

function compareDiscordSnowflakes(left: string, right: string): number {
  const leftValue = BigInt(left);
  const rightValue = BigInt(right);

  if (leftValue === rightValue) {
    return 0;
  }

  return leftValue < rightValue ? -1 : 1;
}
