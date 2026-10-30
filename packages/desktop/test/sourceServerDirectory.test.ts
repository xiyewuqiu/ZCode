import assert from "node:assert/strict";
import test from "node:test";
import type { AppSettings } from "@ycode/shared";
import { SourceServerDirectory } from "../src/host/sourceServerDirectory.js";
import { createSourceServerRecoveryCloseEvent } from "../src/host/sourceServerRecoveryPolicy.js";

function fakeServices() {
  let settings: AppSettings = {
    recentProjects: [],
    locale: "zh-CN",
    sourceServerDirectoryMigrationVersion: 1,
    sourceServers: [],
    connectionProfiles: [],
    sourceServerWorkspaceHistory: [],
  };
  const credentials = new Map<string, string>();
  return {
    settings: () => settings,
    settingService: {
      get: async () => settings,
      update: async (patch: Partial<AppSettings>) => {
        settings = { ...settings, ...patch };
      },
      updateDataBaseDir: async () => {},
      ensureDefaultProject: async () => ({ path: "/tmp/default", created: false }),
    },
    credentialService: {
      load: async (key: string) => credentials.get(key) ?? null,
      save: async (key: string, value: string) => {
        credentials.set(key, value);
      },
      delete: async (key: string) => {
        credentials.delete(key);
      },
    },
    credentials,
  };
}

test("directory ensures one profile per transport identity and persists it", async () => {
  const fake = fakeServices();
  const directory = new SourceServerDirectory({
    settingService: fake.settingService,
    credentialService: fake.credentialService,
    now: () => 1000,
  });

  const first = await directory.ensureProfile(
    { kind: "ssh", host: "Example.COM", port: 22, username: "dev" },
    { deferCredentials: true },
  );
  const second = await directory.ensureProfile(
    { kind: "ssh", host: "example.com", port: 22, username: "dev" },
    { deferCredentials: true },
  );

  assert.equal(first.profileId, second.profileId);
  assert.equal(first.transport, "ssh");
  assert.equal(fake.settings().connectionProfiles?.length, 1);

  const snapshot = await directory.snapshot();
  assert.equal(snapshot.profiles.length, 1);
  assert.equal(snapshot.profiles[0]!.target.kind, "ssh");
  assert.equal(
    snapshot.profiles[0]!.target.kind === "ssh" ? snapshot.profiles[0]!.target.host : undefined,
    "example.com",
  );
});

test("recovery policy exposes retryable and terminal close facts", () => {
  const retrying = createSourceServerRecoveryCloseEvent({
    profileId: "11111111-1111-4111-8111-111111111111",
    state: "retrying",
    error: "network",
    retryable: true,
    recoveryAttempt: 2,
    recoveryLimit: 5,
    updatedAt: 1,
  });
  assert.equal(retrying?.recoverable, true);
  assert.equal(retrying?.recoveryAttempt, 2);

  const failed = createSourceServerRecoveryCloseEvent({
    profileId: "11111111-1111-4111-8111-111111111111",
    state: "failed",
    retryable: false,
    updatedAt: 2,
  });
  assert.equal(failed?.recoverable, false);
  assert.equal(failed?.retryable, false);
});
