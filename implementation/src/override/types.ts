export type OverrideFlags = {
  allowPlaywrightHeaded: boolean;
  allowPlaywrightPersistent: boolean;
  allowPromptInjectionTest: boolean;
  suspendViolationCounterForCurrentThread: boolean;
  allowExternalFetchInPrivateContextWithoutPrivateTerms: boolean;
};

export type OverrideSessionRecord = {
  sessionId: string;
  guildId: string;
  actorId: string;
  grantedBy: string;
  scopePlaceId: string;
  flags: OverrideFlags;
  sandboxMode: "workspace-write";
  startedAt: string;
  endedAt: string | null;
  endedBy: string | null;
  cleanupReason: string | null;
};

export type OverrideContext = {
  active: boolean;
  sameActor: boolean;
  startedBy: string | null;
  startedAt: string | null;
  flags: OverrideFlags;
};

export const DEFAULT_OVERRIDE_FLAGS: OverrideFlags = {
  allowPlaywrightHeaded: false,
  allowPlaywrightPersistent: false,
  allowPromptInjectionTest: false,
  suspendViolationCounterForCurrentThread: false,
  allowExternalFetchInPrivateContextWithoutPrivateTerms: false
};
