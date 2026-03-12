import { resolve } from "node:path";

import type { Scope } from "../domain/types.js";
import { KnowledgeRetrievalService } from "../knowledge/knowledge-retrieval-service.js";
import { SqliteStore } from "../storage/database.js";

export type KnowledgeRuntimeContext = {
  guildId: string;
  rootChannelId: string;
  placeId: string;
  scope: Scope;
};

export function searchKnowledgeRuntime(input: {
  query: string;
  context: KnowledgeRuntimeContext;
  limit?: number;
  cwd?: string;
  dbPath?: string;
}) {
  return withKnowledgeStore(input.cwd, input.dbPath, (store) => {
    const retrieval = new KnowledgeRetrievalService(store);
    return retrieval.searchVisibleCandidates(
      input.limit === undefined
        ? {
            query: input.query,
            context: input.context
          }
        : {
            query: input.query,
            context: input.context,
            limit: input.limit
          }
    );
  });
}

export function getKnowledgeSourceRuntime(input: {
  sourceId: string;
  context: KnowledgeRuntimeContext;
  cwd?: string;
  dbPath?: string;
}) {
  return withKnowledgeStore(input.cwd, input.dbPath, (store) => {
    const retrieval = new KnowledgeRetrievalService(store);
    return (
      retrieval.hydrateSources({
        sourceIds: [input.sourceId],
        context: input.context
      })[0] ?? null
    );
  });
}

function withKnowledgeStore<T>(
  cwd: string | undefined,
  dbPathOverride: string | undefined,
  run: (store: SqliteStore) => T
): T {
  const projectRoot = cwd ?? process.cwd();
  const dbPath = resolveBotDbPath(projectRoot, dbPathOverride);
  const store = new SqliteStore(dbPath, projectRoot);
  store.migrate();

  try {
    return run(store);
  } finally {
    store.close();
  }
}

function resolveBotDbPath(cwd: string, dbPathOverride?: string): string {
  const configured = dbPathOverride ?? process.env.BOT_DB_PATH ?? "bot.sqlite";
  return resolve(cwd, configured);
}
