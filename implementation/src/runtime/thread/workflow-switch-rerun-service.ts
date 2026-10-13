import type { Logger } from "pino";

import { appendRuntimeTrace } from "../../observability/runtime-trace.js";
import type { SqliteStore } from "../../storage/database.js";
import type { QueuedMessage } from "../types.js";

type EnqueueWorkflowSwitchRerun = (item: QueuedMessage) => boolean;

type ActiveWorkflowMessage = {
  item: QueuedMessage;
  controller: AbortController;
};

export class WorkflowSwitchRerunService {
  private readonly activeByThreadId = new Map<string, ActiveWorkflowMessage>();
  private readonly signals = new WeakMap<QueuedMessage, AbortSignal>();
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
    this.activeByThreadId.get(threadId)?.controller.abort(new Error("Workflow execution replaced"));
    const active: ActiveWorkflowMessage = { item, controller: new AbortController() };
    this.activeByThreadId.set(threadId, active);
    this.signals.set(item, active.controller.signal);
    return () => {
      if (this.activeByThreadId.get(threadId) === active) {
        this.activeByThreadId.delete(threadId);
      }
      active.controller.abort(new Error("Workflow execution ended"));
    };
  }

  activeSignal(item: QueuedMessage): AbortSignal | undefined {
    return this.signals.get(item);
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
    active.controller.abort(new Error("Workflow switched"));
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
