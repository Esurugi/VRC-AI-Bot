import test from "node:test";
import assert from "node:assert/strict";

import { PermissionsBitField } from "discord.js";

import { DiscordModerationExecutor } from "../src/discord/moderation-executor.js";

test("DiscordModerationExecutor applies timeout when permissions and hierarchy allow it", async () => {
  let timedOutWith: { durationMs: number; reason: string } | null = null;
  const executor = new DiscordModerationExecutor(
    {
      guilds: {
        fetch: async () =>
          ({
            id: "guild-1",
            members: {
              me: {
                permissions: new PermissionsBitField(PermissionsBitField.Flags.ModerateMembers)
              },
              fetch: async () =>
                ({
                  moderatable: true,
                  timeout: async (durationMs: number, reason: string) => {
                    timedOutWith = { durationMs, reason };
                  }
                })
            }
          }) as never
      } as never
    } as never
  );

  const result = await executor.timeoutMember("guild-1", "user-1", 86_400_000, "threshold reached");

  assert.deepEqual(result, {
    ok: true,
    action: "timeout",
    deliveryStatus: "applied"
  });
  assert.deepEqual(timedOutWith, {
    durationMs: 86_400_000,
    reason: "threshold reached"
  });
});

test("DiscordModerationExecutor reports missing timeout permission", async () => {
  const executor = new DiscordModerationExecutor(
    {
      guilds: {
        fetch: async () =>
          ({
            id: "guild-1",
            members: {
              me: {
                permissions: new PermissionsBitField([])
              },
              fetch: async () => {
                throw new Error("should not fetch target member without permission");
              }
            }
          }) as never
      } as never
    } as never
  );

  const result = await executor.timeoutMember("guild-1", "user-1", 60_000, "reason");

  assert.deepEqual(result, {
    ok: false,
    action: "timeout",
    deliveryStatus: "failed",
    failureReason: "missing_permission",
    message: "missing MODERATE_MEMBERS permission"
  });
});

test("DiscordModerationExecutor reports member_not_found for unknown member", async () => {
  const executor = new DiscordModerationExecutor(
    {
      guilds: {
        fetch: async () =>
          ({
            id: "guild-1",
            members: {
              me: {
                permissions: new PermissionsBitField(PermissionsBitField.Flags.KickMembers)
              },
              fetch: async () => {
                const error = new Error("Unknown Member") as Error & { code: number };
                error.code = 10007;
                throw error;
              }
            }
          }) as never
      } as never
    } as never
  );

  const result = await executor.kickMember("guild-1", "user-1", "reason");

  assert.deepEqual(result, {
    ok: false,
    action: "kick",
    deliveryStatus: "failed",
    failureReason: "member_not_found",
    message: "Unknown Member"
  });
});

test("DiscordModerationExecutor reports hierarchy_blocked for non-kickable member", async () => {
  const executor = new DiscordModerationExecutor(
    {
      guilds: {
        fetch: async () =>
          ({
            id: "guild-1",
            members: {
              me: {
                permissions: new PermissionsBitField(PermissionsBitField.Flags.KickMembers)
              },
              fetch: async () =>
                ({
                  kickable: false,
                  kick: async () => {
                    throw new Error("should not kick non-kickable member");
                  }
                })
            }
          }) as never
      } as never
    } as never
  );

  const result = await executor.kickMember("guild-1", "user-1", "reason");

  assert.deepEqual(result, {
    ok: false,
    action: "kick",
    deliveryStatus: "failed",
    failureReason: "hierarchy_blocked",
    message: "target member is not kickable"
  });
});
