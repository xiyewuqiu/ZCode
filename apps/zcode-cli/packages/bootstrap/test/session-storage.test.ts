import assert from "node:assert/strict";
import test from "node:test";
import {
  SessionResidentPool,
  type SessionResidencyFacts,
} from "../src/zcode-protocol/session-resident-pool.js";
import { purgeSessionStorage } from "../src/zcode-protocol/session-storage.js";
import type { ZCodeProtocolAgentServerContext } from "../src/zcode-protocol/server-types.js";

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
  } as unknown as ZCodeProtocolAgentServerContext;
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
