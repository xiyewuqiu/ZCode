import assert from "node:assert/strict";
import test from "node:test";
import {
  SessionResidentPool,
  type SessionResidencyFacts,
} from "../src/ycode-protocol/session-resident-pool.js";
import {
  optimizeSessionDatabase,
  purgeSessionStorage,
} from "../src/ycode-protocol/session-storage.js";
import type { YCodeProtocolAgentServerContext } from "../src/ycode-protocol/server-types.js";

test("maintenance rejects in-flight work and blocks new requests until released", async () => {
  let deactivated = false;
  const facts: SessionResidencyFacts = {
    persisted: true,
    hasResidencyBlockingWork: false,
    hasPendingInteractions: false,
    hasQueuedCommands: false,
    hasSubscribers: false,
    hasLegacySubscriber: false,
    lastActivityAt: Date.now(),
  };
  const pool = new SessionResidentPool({
    listSessionIds: () => ["one"],
    readResidencyFacts: () => facts,
    deactivate: async () => {
      deactivated = true;
    },
  });
  const operation = await pool.acquireOperation("one");
  assert.throws(() => pool.acquireStorageMaintenance(), /busy/);
  operation();
  const release = pool.acquireStorageMaintenance();
  await assert.rejects(pool.acquireOperation("one"), /busy/);
  facts.hasSubscribers = true;
  assert.equal(pool.isStorageBlocked("one"), true);
  await assert.rejects(pool.deactivateForStorage("one"), /session-active/);
  assert.equal(deactivated, false);
  facts.hasSubscribers = false;
  await pool.deactivateForStorage("one");
  assert.equal(deactivated, true);
  release();
  (await pool.acquireOperation("one"))();
});

test("protocol validates confirmation, checks preview before close, and always releases maintenance", async () => {
  const order: string[] = [];
  const pool = new SessionResidentPool({
    listSessionIds: () => [],
    readResidencyFacts: () => null,
    deactivate: async () => {
      order.push("close");
    },
  });
  const context = {
    sessionResidentPool: pool,
    deps: {
      sessionStore: {
        previewSessionStorage: async () => ({
          sessionId: "one",
          revision: "current",
          state: "present",
          logicalBytes: 1,
          recordCount: 1,
          ownedFileBytes: 0,
          ownedFileCount: 0,
          blockers: [],
        }),
        purgeSessionStorage: async () => {
          order.push("purge");
          throw new Error("disk failure");
        },
      },
    },
  } as unknown as YCodeProtocolAgentServerContext;
  const params = {
    sessionId: "one",
    workspaceKey: "work",
    expectedRevision: "current",
    confirmPermanent: true,
  };
  await assert.rejects(purgeSessionStorage(context, { ...params, confirmPermanent: false }));
  await assert.rejects(
    purgeSessionStorage(context, { ...params, expectedRevision: "stale" }),
    /stale/,
  );
  assert.deepEqual(order, []);
  await assert.rejects(purgeSessionStorage(context, params), /disk failure/);
  assert.deepEqual(order, ["close", "purge"]);
  (await pool.acquireOperation("one"))();
});

test("database maintenance refuses active or in-flight sessions and releases the gate", async () => {
  const stats = {
    databaseBytes: 8192,
    walBytes: 0,
    pageSize: 4096,
    pageCount: 2,
    freelistCount: 0,
    freelistBytes: 0,
    autoVacuum: 0,
    journalMode: "wal",
  };
  const facts: SessionResidencyFacts = {
    persisted: true,
    hasResidencyBlockingWork: false,
    hasPendingInteractions: false,
    hasQueuedCommands: false,
    hasSubscribers: false,
    hasLegacySubscriber: false,
    lastActivityAt: Date.now(),
  };
  const pool = new SessionResidentPool({
    listSessionIds: () => ["one"],
    readResidencyFacts: () => facts,
    deactivate: async () => {},
  });
  let optimized = 0;
  const context = {
    sessionResidentPool: pool,
    deps: {
      sessionStore: {
        getSessionDatabaseStats: async () => ({ ...stats }),
        optimizeSessionDatabase: async () => {
          optimized++;
          return {
            status: "optimized",
            action: "optimize-only",
            reason: "freelist-low",
            before: stats,
            after: stats,
            reclaimedBytes: 0,
            durationMs: 1,
          };
        },
      },
    },
  } as unknown as YCodeProtocolAgentServerContext;

  await assert.rejects(optimizeSessionDatabase(context, {}));
  facts.hasResidencyBlockingWork = true;
  const active = await optimizeSessionDatabase(context, { confirm: true });
  assert.equal(active.status, "refused");
  assert.equal(active.reason, "sessions-active");
  assert.equal(optimized, 0);

  facts.hasResidencyBlockingWork = false;
  const operation = await pool.acquireOperation("one");
  const busy = await optimizeSessionDatabase(context, { confirm: true });
  assert.equal(busy.status, "refused");
  assert.equal(busy.reason, "database-busy");
  operation();

  const result = await optimizeSessionDatabase(context, { confirm: true });
  assert.equal(result.status, "optimized");
  assert.equal(optimized, 1);
  // 维护结束后闸门必须释放，普通请求可以继续。
  (await pool.acquireOperation("one"))();
});
