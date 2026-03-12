import { parseInspectArgs, printJson, withRetrievalStore } from "./_shared.ts";

const args = parseInspectArgs();

const sources = withRetrievalStore(args.dbPath, (service) =>
  service.hydrateSources({
    sourceIds: [args.sourceId ?? ""],
    context: {
      guildId: args.guildId,
      rootChannelId: args.rootChannelId,
      placeId: args.placeId,
      scope: args.scope
    }
  })
);

printJson({
  context: {
    guildId: args.guildId,
    rootChannelId: args.rootChannelId,
    placeId: args.placeId,
    scope: args.scope
  },
  source: sources[0] ?? null
});
