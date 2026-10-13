/** Rate limits Discord side effects; it never generates or judges progress content. */
export class ResearchProgressDelivery {
  private readonly pending = new Set<string>();
  private readonly published: string[] = [];
  private lastSentAt = Number.NEGATIVE_INFINITY;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private sending = false;
  private closed = false;

  constructor(
    private readonly send: (content: string) => Promise<void>,
    private readonly onError: (error: unknown) => void,
    private readonly signal?: AbortSignal
  ) {
    signal?.addEventListener("abort", this.stop, { once: true });
  }

  recent = (): string[] => [...this.published];

  offer = async (content: string): Promise<void> => {
    const text = content.trim();
    if (!text || this.closed || this.signal?.aborted || this.published.includes(text)) return;
    this.pending.add(text);
    if (this.sending || this.timer) return;
    const wait = 30_000 - (Date.now() - this.lastSentAt);
    if (wait > 0) {
      this.timer = setTimeout(() => {
        this.timer = null;
        void this.flush().catch(this.onError);
      }, wait);
    } else {
      await this.flush().catch(this.onError);
    }
  };

  stop = (): void => {
    this.closed = true;
    this.pending.clear();
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.signal?.removeEventListener("abort", this.stop);
  };

  private async flush(): Promise<void> {
    if (this.closed || this.signal?.aborted || this.sending || this.pending.size === 0) return;
    const messages = [...this.pending];
    this.pending.clear();
    this.sending = true;
    try {
      await this.send(messages.join("\n\n"));
      this.lastSentAt = Date.now();
      this.published.push(...messages);
    } finally {
      this.sending = false;
    }
    if (this.pending.size > 0 && !this.closed) {
      this.timer = setTimeout(() => {
        this.timer = null;
        void this.flush().catch(this.onError);
      }, 30_000);
    }
  }
}
