import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { projectStorage } from "../src/project-storage/index.js";
import { createRemoteProjectService } from "../src/remote-projects/index.js";
import type { RemoteProjectCache } from "../src/remote-projects/contract.js";

async function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  const directory = await mkdtemp(join(tmpdir(), "remote-project-test-"));
  await projectStorage.migrate(db, { backupDirectories: [directory] });
  let changes = 0;
  const service = createRemoteProjectService({
    database: async () => db,
    afterChange: () => {
      changes += 1;
    },
    now: () => 100,
  });
  const target = { kind: "ssh" as const, host: "example.test", username: "user" };
  await service.saveHost({ id: "source", target });
  const project: RemoteProjectCache = {
    projectId: "p",
    name: "Remote",
    roots: [{ rootPath: "/repo", position: 0, isPrimary: true }],
  };
  return {
    db,
    service,
    target,
    project,
    changes: () => changes,
    resetChanges: () => {
      changes = 0;
    },
    dispose: async () => {
      db.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

test("reconnects through the existing connector and reads runtime state without persisting it", async () => {
  const { db, target, dispose } = await fixture();
  try {
    let connectCalls = 0;
    const state = {
      connectionStatus: "offline" as "offline" | "online",
      lastConnectionError: "SSH refused" as string | undefined,
    };
    const service = createRemoteProjectService({
      database: async () => db,
      connectHost: async () => {
        connectCalls += 1;
        return "source";
      },
      readConnectionStates: async () => new Map([["source", state]]),
    });
    assert.equal((await service.readDirectory()).hosts[0]?.lastConnectionError, "SSH refused");
    state.connectionStatus = "online";
    state.lastConnectionError = undefined;
    const host = await service.connectHost("source");
    assert.equal(host.lastConnectionError, undefined);
    assert.equal(connectCalls, 1);
    assert.equal(host.connectionStatus, "online");
    assert.deepEqual(
      (({ host_id, target_json }) => ({ host_id, target_json }))(
        db.prepare("SELECT * FROM hosts WHERE host_id=?").get("source") as Record<string, unknown>,
      ),
      { host_id: "source", target_json: JSON.stringify(target) },
    );
    assert.equal(
      (
        db
          .prepare("SELECT last_connection_status,last_connection_error FROM hosts WHERE host_id=?")
          .get("source") as Record<string, unknown>
      ).last_connection_status,
      null,
    );
    await service.removeHost("source");
    await assert.rejects(service.connectHost("source"), /host-not-found/);
    assert.equal(connectCalls, 1);
  } finally {
    await dispose();
  }
});

test("allows an owner-only client to read its project tree without touching controller storage", async () => {
  let accesses = 0;
  const service = createRemoteProjectService({
    controller: false,
    database: async () => {
      accesses += 1;
      throw new Error("must not access controller storage");
    },
  });
  assert.deepEqual(await service.readDirectory(), { hosts: [], entries: [] });
  await assert.rejects(
    service.saveHost({ id: "remote:server:s", target: { kind: "docker", container: "s" } }),
    /controller-only/,
  );
  await assert.rejects(service.removeEntry("entry"), /controller-only/);
  assert.equal(accesses, 0);
});

test("deduplicates legacy cwd entries only after a matching CAS resolves their project", async () => {
  const { db, service, project, dispose } = await fixture();
  try {
    const retained = await service.addEntry({ hostId: "source", project });
    db.prepare(
      "INSERT INTO remote_project_entries(entry_id,host_id,cached_name,cached_roots_json) VALUES('legacy','source','old','[]')",
    ).run();
    assert.equal(
      await service.refreshEntry({ entryId: "legacy", expectedLastSyncedAt: 1, project }),
      false,
    );
    assert.equal((await service.readDirectory()).entries.length, 2);
    assert.equal(
      await service.refreshEntry({ entryId: "legacy", expectedLastSyncedAt: null, project }),
      true,
    );
    assert.deepEqual((await service.readDirectory()).entries, [retained]);
    assert.equal(
      await service.refreshEntry({ entryId: "legacy", expectedLastSyncedAt: null, project }),
      false,
    );
  } finally {
    await dispose();
  }
});

test("does not bind a removed and re-added membership from an older handshake", async () => {
  const { service, target, dispose } = await fixture();
  try {
    const old = (await service.readDirectory()).hosts[0]!;
    await service.removeHost(old.id);
    assert.equal(
      await service.bindHost({
        id: old.id,
        membershipId: old.membershipId,
        resolvedId: "remote:server:old",
      }),
      null,
    );
    const fresh = await service.saveHost({ id: old.id, target });
    assert.notEqual(fresh.membershipId, old.membershipId);
    assert.equal(
      await service.bindHost({
        id: old.id,
        membershipId: old.membershipId,
        resolvedId: "remote:server:old",
      }),
      null,
    );
    assert.deepEqual(
      (await service.readDirectory()).hosts.map((host) => host.id),
      [old.id],
    );
  } finally {
    await dispose();
  }
});

test("does not transplant project entries between distinct stable physical Sources", async () => {
  const { service, target, dispose } = await fixture();
  try {
    const host = await service.saveHost({ id: "remote:server:a", target });
    await assert.rejects(
      service.bindHost({
        id: host.id,
        membershipId: host.membershipId,
        resolvedId: "remote:server:b",
      }),
      /source-identity-changed/,
    );
  } finally {
    await dispose();
  }
});

test("removes only the host and its entries, leaving other hosts and authoritative projects", async () => {
  const { db, service, target, project, dispose } = await fixture();
  try {
    await service.saveHost({ id: "second", target });
    await service.addEntry({ hostId: "source", project });
    await service.addEntry({ hostId: "second", project });
    const local = projectStorage.repository(db).saveProject({ name: "Local", roots: [] });
    await service.removeHost("source");
    const directory = await service.readDirectory();
    assert.deepEqual(
      directory.hosts.map((host) => host.id),
      ["second"],
    );
    assert.deepEqual(
      directory.entries.map((entry) => entry.hostId),
      ["second"],
    );
    assert.equal(
      (db.prepare("SELECT project_id FROM projects").get() as { project_id: string }).project_id,
      local.id,
    );
    await assert.rejects(service.removeHost("local"), /local-host/);
  } finally {
    await dispose();
  }
});

test("enforces host capacity atomically and permits editing an existing host", async () => {
  const { service, target, dispose } = await fixture();
  try {
    for (let index = 1; index < 20; index++) {
      await service.saveHost({ id: `host-${index}`, target });
    }
    await assert.rejects(service.saveHost({ id: "overflow", target }), /host-limit/);
    await service.saveHost({ id: "source", target: { ...target, host: "updated" } });
    assert.equal((await service.readDirectory()).hosts.length, 20);
  } finally {
    await dispose();
  }
});

test("advances an unchanged refresh version without broadcasting a projection change", async () => {
  const { service, project, resetChanges, changes, dispose } = await fixture();
  try {
    const entry = await service.addEntry({ hostId: "source", project });
    resetChanges();
    assert.equal(
      await service.refreshEntry({
        entryId: entry.id,
        expectedLastSyncedAt: entry.lastSyncedAt,
        project,
      }),
      true,
    );
    assert.equal(changes(), 0);
    const current = (await service.readDirectory()).entries[0]!;
    assert.equal(current.lastSyncedAt! > entry.lastSyncedAt!, true);
    assert.equal(
      await service.refreshEntry({
        entryId: entry.id,
        expectedLastSyncedAt: entry.lastSyncedAt,
        project: { ...project, name: "stale" },
      }),
      false,
    );
  } finally {
    await dispose();
  }
});

test("rejects credentials and malformed project cache before writing", async () => {
  const { service, target, project, resetChanges, changes, dispose } = await fixture();
  try {
    resetChanges();
    await assert.rejects(
      service.saveHost({
        id: "secret",
        target: { ...target, password: "secret" } as typeof target,
      }),
    );
    await assert.rejects(service.addEntry({ hostId: "missing", project }));
    await assert.rejects(
      service.addEntry({
        hostId: "source",
        project: { ...project, roots: [{ ...project.roots[0]!, isPrimary: false }] },
      }),
    );
    assert.equal(changes(), 0);
  } finally {
    await dispose();
  }
});
