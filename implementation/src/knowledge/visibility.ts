import type { Scope } from "../domain/types.js";

export type KnowledgeVisibilityContext = {
  guildId: string;
  rootChannelId: string;
  placeId: string;
  scope: Scope;
};

export function buildVisibilityKey(input: KnowledgeVisibilityContext): string {
  switch (input.scope) {
    case "server_public":
      return `server_public:${input.guildId}`;
    case "channel_family":
      return `channel_family:${input.rootChannelId}`;
    case "conversation_only":
      return `conversation_only:${input.placeId}`;
  }
}

export function listVisibleKnowledgeSelectors(input: KnowledgeVisibilityContext): {
  scopes: Scope[];
  visibilityKeys: string[];
} {
  const serverPublicKey = `server_public:${input.guildId}`;
  const channelFamilyKey = `channel_family:${input.rootChannelId}`;
  const conversationOnlyKey = `conversation_only:${input.placeId}`;

  switch (input.scope) {
    case "server_public":
      return {
        scopes: ["server_public"],
        visibilityKeys: [serverPublicKey]
      };
    case "channel_family":
      return {
        scopes: ["server_public", "channel_family"],
        visibilityKeys: [serverPublicKey, channelFamilyKey]
      };
    case "conversation_only":
      return {
        scopes: ["server_public", "channel_family", "conversation_only"],
        visibilityKeys: [serverPublicKey, channelFamilyKey, conversationOnlyKey]
      };
  }
}
