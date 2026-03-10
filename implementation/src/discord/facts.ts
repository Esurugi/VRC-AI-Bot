import { ChannelType, PermissionsBitField, type Message } from "discord.js";

import type { ActorRole, Scope, WatchLocationConfig } from "../domain/types.js";

export function resolveActorRole(
  message: Message<true>,
  ownerUserIds: string[]
): ActorRole {
  if (ownerUserIds.includes(message.author.id)) {
    return "owner";
  }

  const member = message.member;
  if (member?.permissions.has(PermissionsBitField.Flags.Administrator)) {
    return "admin";
  }

  return "user";
}

export function resolveScope(
  message: Message<true>,
  watchLocation: WatchLocationConfig
): Scope {
  if (watchLocation.mode === "admin_control") {
    return "conversation_only";
  }

  if (message.channel.type === ChannelType.PrivateThread) {
    return "conversation_only";
  }

  return watchLocation.defaultScope;
}
