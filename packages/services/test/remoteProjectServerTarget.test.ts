import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { projectStorage } from "#src/project-storage/index.js";
import {
  createRemoteProjectService,
  prepareRemoteServerConnection,
} from "#src/remote-projects/index.js";
import type { RemoteProjectCache } from "#src/remote-projects/contract.js";

async function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  const directory = await mkdtemp(join(tmpdir(), "remote-project-server-test-"));
  await projectStorage.migrate(db, { backupDirectories: [directory] });
  let changes = 0;
  const service = createRemoteProjectService({
    database: async () => db,
    afterChange: () => {
      changes += 1;
    },
    now: () => 100,
  });
  const project: RemoteProjectCache = {
    projectId: "p",
    name: "Remote",
    roots: [{ rootPath: "/repo", position: 0, isPrimary: true }],
  };
  return {
    db,
    service,
    project,
    changes: () => changes,
    dispose: async () => {
      db.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

test("URL 首次握手固化稳定身份，下一次身份变化不能迁移入口", async (t) => {
  const f = await fixture();
  t.after(f.dispose);
  const host = await f.service.saveHost({
    id: "remote:server:example-test",
    target: {
      kind: "server",
      url: "https://example.test",
      tokenCredentialKey: "token-key",
    },
  });
  const entry = await f.service.addEntry({ hostId: host.id, project: f.project });
  const bound = await f.service.bindHost({
    id: host.id,
    membershipId: host.membershipId,
    resolvedId: "remote:server:stable",
  });
  assert.equal(bound?.target?.kind, "server");
  assert.deepEqual(
    bound?.target?.kind === "server"
      ? { serverId: bound.target.serverId, tokenCredentialKey: bound.target.tokenCredentialKey }
      : null,
    { serverId: "stable", tokenCredentialKey: "token-key" },
  );
  assert.equal(
    (await f.service.readDirectory()).entries.find((item) => item.id === entry.id)?.hostId,
    "remote:server:stable",
  );
  await assert.rejects(
    f.service.bindHost({
      id: bound!.id,
      membershipId: bound!.membershipId,
      resolvedId: "remote:server:other",
    }),
    /remote-project\.source-identity-changed/,
  );
});

test("URL admission 复用凭据服务，保留连接不重建成员，迟到握手不能复活入口", async (t) => {
  const f = await fixture();
  t.after(f.dispose);
  const secrets = new Map<string, string>();
  const credentials = {
    async load(key: string) {
      return secrets.get(key) ?? null;
    },
    async save(key: string, value: string) {
      secrets.set(key, value);
    },
  };
  const input = { kind: "server" as const, url: "https://example.test", token: "secret" };
  const admission = await prepareRemoteServerConnection({
    service: f.service,
    credentials,
    target: input,
    intent: "add",
  });
  assert.equal(admission.target.token, "secret");
  const saved = (await f.service.readDirectory()).hosts.find((host) => host.kind === "server")!;
  assert.ok(!JSON.stringify(saved).includes("secret"));
  await admission.commit("stable");
  const retained = await prepareRemoteServerConnection({
    service: f.service,
    credentials,
    target: { ...input, token: undefined, serverId: "stable" },
    intent: "retain",
  });
  assert.equal(retained.target.token, "secret");
  await f.service.removeHost("remote:server:stable");
  await assert.rejects(retained.commit("stable"), /remote-project\.host-removed/);
  await assert.rejects(
    prepareRemoteServerConnection({
      service: f.service,
      credentials,
      target: retained.target,
      intent: "retain",
    }),
    /remote-project\.host-removed/,
  );
  assert.equal(
    (await f.service.readDirectory()).hosts.some((host) => host.kind === "server"),
    false,
  );
});
