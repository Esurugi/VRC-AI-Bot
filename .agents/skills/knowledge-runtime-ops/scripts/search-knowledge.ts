import { printJson, parseSearchArgs, withRetrievalStore } from "./_shared.ts";

const args = parseSearchArgs();

const results = withRetrievalStore(args.dbPath, (service) =>
  service.searchVisibleCandidates({
    query: args.query ?? "",
    context: {
      guildId: args.guildId,
      rootChannelId: args.rootChannelId,
      placeId: args.placeId,
      scope: args.scope
    },
    limit: args.limit
  })
);

printJson({
  query: args.query,
  context: {
    guildId: args.guildId,
    rootChannelId: args.rootChannelId,
    placeId: args.placeId,
    scope: args.scope
  },
  count: results.length,
  results
});
