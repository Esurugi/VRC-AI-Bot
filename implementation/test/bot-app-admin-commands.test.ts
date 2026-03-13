import test from "node:test";
import assert from "node:assert/strict";

import {
  buildOverrideCommandDefinitions,
  mergeOverrideCommandDefinitions
} from "../src/app/bot-app.js";

test("buildOverrideCommandDefinitions registers admin-only override commands", () => {
  const commands = buildOverrideCommandDefinitions();
  const startCommand = commands[0] as {
    name: string;
    default_member_permissions: string | null;
    options?: Array<{ name: string }>;
  };
  const endCommand = commands[1] as {
    name: string;
    default_member_permissions: string | null;
  };

  assert.equal(startCommand.name, "override-start");
  assert.equal(endCommand.name, "override-end");
  assert.ok(startCommand.default_member_permissions);
  assert.equal(startCommand.default_member_permissions, endCommand.default_member_permissions);
  assert.deepEqual(
    startCommand.options?.map((option) => option.name),
    [
      "prompt",
      "allow_playwright_headed",
      "allow_playwright_persistent",
      "allow_prompt_injection_test",
      "suspend_violation_counter",
      "allow_private_external_fetch"
    ]
  );
});

test("mergeOverrideCommandDefinitions preserves unrelated guild commands", () => {
  const merged = mergeOverrideCommandDefinitions(
    [
      {
        name: "ping",
        toJSON() {
          return {
            name: "ping",
            description: "existing ping"
          };
        }
      },
      {
        name: "override-start",
        toJSON() {
          return {
            name: "override-start",
            description: "stale"
          };
        }
      }
    ],
    buildOverrideCommandDefinitions()
  ) as Array<{ name: string; description?: string }>;

  assert.equal(merged.filter((command) => command.name === "ping").length, 1);
  assert.equal(merged.filter((command) => command.name === "override-start").length, 1);
  assert.equal(merged.filter((command) => command.name === "override-end").length, 1);
  assert.ok(merged.find((command) => command.name === "override-start")?.description);
});
