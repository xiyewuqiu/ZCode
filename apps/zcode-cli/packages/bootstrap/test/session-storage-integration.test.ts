import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Writable } from "node:stream";
import { sessionStoragePreviewSchema, sessionPurgeResultSchema } from "@zcode/shared";
import { V4_METHODS } from "@zcode/shared/zcode-protocol-v4";
import { ZCodeProtocolAgentServer } from "../src/zcode-protocol/server.js";
import { openProtocolStartupStorage } from "../src/zcode-protocol/storage-startup.js";

test("actual protocol startup, dispatch and SQLite maintenance complete without creating a runtime", async () => {
  const root = await mkdtemp(join(tmpdir(), "zcode-purge-protocol-"));
  const dbPath = join(root, "custom.sqlite");
  const store = await openProtocolStartupStorage({
    dbPath,
    storageRoot: root,
    output: new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    }),
  });
  const server = new ZCodeProtocolAgentServer({
    sessionStore: store,
    createZCodeApp: () => {
      throw new Error("must not start model runtime");
    },
  });
  try {
    const db = new DatabaseSync(dbPath);
    db.exec(
      "insert into session(id,project_id,slug,directory,title,version,time_created,time_updated) values('one','project','one','/workspace','private','test',1,1)",
    );
    db.close();
    const target = { sessionId: "one", workspaceKey: "/workspace" };
    const checked = await server.handleMessage({
      id: 1,
      method: V4_METHODS.conversationStorage,
      params: target,
    });
    assert.ok(checked && "result" in checked, JSON.stringify(checked));
    const preview = sessionStoragePreviewSchema.parse(checked.result);
    assert.deepEqual(preview.blockers, []);
    const denied = await server.handleMessage({
      id: 2,
      method: V4_METHODS.conversationPurge,
      params: { ...target, expectedRevision: preview.revision, confirmPermanent: false },
    });
    assert.ok(denied && "error" in denied);
    const deleted = await server.handleMessage({
      id: 3,
      method: V4_METHODS.conversationPurge,
      params: { ...target, expectedRevision: preview.revision, confirmPermanent: true },
    });
    assert.ok(deleted && "result" in deleted, JSON.stringify(deleted));
    assert.equal(sessionPurgeResultSchema.parse(deleted.result).state, "purged");
    const retry = await server.handleMessage({
      id: 4,
      method: V4_METHODS.conversationPurge,
      params: { ...target, expectedRevision: preview.revision, confirmPermanent: true },
    });
    assert.ok(retry && "result" in retry, JSON.stringify(retry));
    const verify = new DatabaseSync(dbPath);
    assert.equal(verify.prepare("select count(*) n from session").get()?.n, 0);
    verify.close();
  } finally {
    await server.shutdown();
    server.disposeProjections();
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});
