import test from "node:test";
import assert from "node:assert/strict";

import { ChannelType, PermissionsBitField } from "discord.js";

import { resolveActorRole, resolveScope } from "../src/discord/facts.js";

test("resolveActorRole prefers owner over admin", () => {
  const role = resolveActorRole(
    {
      author: { id: "owner-1" },
      member: {
        permissions: new PermissionsBitField(PermissionsBitField.Flags.Administrator)
      }
    } as never,
    ["owner-1"]
  );

  assert.equal(role, "owner");
});

test("resolveActorRole falls back to admin and user", () => {
  const adminRole = resolveActorRole(
    {
      author: { id: "user-1" },
      member: {
        permissions: new PermissionsBitField(PermissionsBitField.Flags.Administrator)
      }
    } as never,
    []
  );
  const userRole = resolveActorRole(
    {
      author: { id: "user-2" },
      member: {
        permissions: new PermissionsBitField([])
      }
    } as never,
    []
  );

  assert.equal(adminRole, "admin");
  assert.equal(userRole, "user");
});

test("resolveScope makes admin control and private thread conversation_only", () => {
  const adminScope = resolveScope(
    {
      channel: {
        type: ChannelType.GuildText
      }
    } as never,
    {
      guildId: "guild-1",
      channelId: "channel-1",
      mode: "admin_control",
      defaultScope: "server_public"
    }
  );
  const privateThreadScope = resolveScope(
    {
      channel: {
        type: ChannelType.PrivateThread
      }
    } as never,
    {
      guildId: "guild-1",
      channelId: "channel-1",
      mode: "chat",
      defaultScope: "server_public"
    }
  );

  assert.equal(adminScope, "conversation_only");
  assert.equal(privateThreadScope, "conversation_only");
});
