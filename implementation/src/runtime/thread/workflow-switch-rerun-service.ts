import type { Logger } from "pino";

import { appendRuntimeTrace } from "../../observability/runtime-trace.js";
import type { SqliteStore } from "../../storage/database.js";
import type { QueuedMessage } from "../types.js";

type EnqueueWorkflowSwitchRerun = (item: QueuedMessage) => boolean;

type ActiveWorkflowMessage = {
  item: QueuedMessage;
};

export class WorkflowSwitchRerunService {
  private readonly activeByThreadId = new Map<string, ActiveWorkflowMessage>();
  private readonly requestedMessageIds = new Set<string>();
  private enqueueRerun: EnqueueWorkflowSwitchRerun | null = null;

  constructor(
    private readonly store: SqliteStore,
    private readonly logger: Pick<Logger, "warn" | "debug">
  ) {}

  setEnqueueRerun(enqueue: EnqueueWorkflowSwitchRerun): void {
    this.enqueueRerun = enqueue;
  }

  trackActive(item: QueuedMessage): () => void {
    const threadId = item.envelope.channelId;
    const active: ActiveWorkflowMessage = { item };
    this.activeByThreadId.set(threadId, active);
    return () => {
      if (this.activeByThreadId.get(threadId) === active) {
        this.activeByThreadId.delete(threadId);
      }
    };
  }

  requestRerun(threadId: string): {
    requested: boolean;
    enqueued: boolean;
    messageId: string | null;
  } {
    const active = this.activeByThreadId.get(threadId);
    if (!active) {
      return {
        requested: false,
        enqueued: false,
        messageId: null
      };
    }

    if (!this.enqueueRerun) {
      this.logger.warn(
        {
          threadId
        },
        "workflow switch rerun requested before enqueue callback was configured"
      );
      return {
        requested: false,
        enqueued: false,
        messageId: active.item.envelope.messageId
      };
    }

    const messageId = active.item.envelope.messageId;
    const marked = this.store.messageProcessing.markRerunRequested(messageId);
    if (!marked) {
      this.logger.debug(
        {
          messageId,
          threadId
        },
        "workflow switch rerun skipped because active message was not processing"
      );
      return {
        requested: false,
        enqueued: false,
        messageId
      };
    }

    this.requestedMessageIds.add(messageId);
    const rerunItem: QueuedMessage = {
      ...active.item,
      source: "workflow_switch_rerun"
    };
    const enqueued = this.enqueueRerun(rerunItem);
    if (!enqueued) {
      this.logger.warn(
        {
          messageId,
          threadId
        },
        "workflow switch rerun was requested but could not be enqueued"
      );
    }

    appendRuntimeTrace("codex-app-server", "workflow_switch_rerun_requested", {
      message_id: messageId,
      thread_id: threadId,
      enqueued
    });
    return {
      requested: true,
      enqueued,
      messageId
    };
  }

  isRerunRequested(messageId: string): boolean {
    return this.requestedMessageIds.has(messageId);
  }

  clearRerunRequest(messageId: string): void {
    this.requestedMessageIds.delete(messageId);
  }
}
