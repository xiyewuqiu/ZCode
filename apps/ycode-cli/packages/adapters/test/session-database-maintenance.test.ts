import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSqliteSessionMigrations } from "../src/storage/session-store/migration-runner.js";
import {
  optimizeSessionDatabase,
  readSessionDatabaseStats,
} from "../src/storage/session-store/session-database-maintenance.js";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "ycode-db-maintenance-test-"));
  const dbPath = join(root, "session.sqlite");
  const db = new DatabaseSync(dbPath);
  db.exec("pragma foreign_keys=on");
  runSqliteSessionMigrations(db, dbPath);
  return {
    db,
    dbPath,
    addSession(id: string) {
      db.prepare(
        "insert into session(id,project_id,workspace_id,parent_id,slug,directory,title,version,time_created,time_updated) values(?,?,?,?,?,?,?,?,?,?)",
      ).run(id, "project", "workspace", null, id, "/workspace", id, "test", 1, 1);
    },
    addMessage(id: string, bytes: number) {
      db.prepare(
        "insert into message(id,session_id,time_created,time_updated,data) values(?,?,1,1,?)",
      ).run(id, "keep", JSON.stringify({ text: "x".repeat(bytes) }));
    },
    async close() {
      db.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}

test("stats report pages and freelist after deleting rows", async () => {
  const f = await fixture();
  try {
    f.addSession("keep");
    for (let index = 0; index < 400; index++) f.addMessage(`m-${index}`, 1024);
    const before = await readSessionDatabaseStats(f.db, f.dbPath);
    assert.ok(before.databaseBytes > 0);
    assert.equal(before.pageSize, 4096);
    assert.ok(before.pageCount > 0);
    assert.equal(before.journalMode, "wal");

    f.db.exec("delete from message");
    const after = await readSessionDatabaseStats(f.db, f.dbPath);
    assert.ok(after.freelistCount > 0);
    assert.equal(after.freelistBytes, after.freelistCount * after.pageSize);
    assert.equal(f.db.prepare("select count(*) n from message").get()?.n, 0);
  } finally {
    await f.close();
  }
});

test("large freelist triggers VACUUM and keeps rows intact", async () => {
  const f = await fixture();
  try {
    f.addSession("keep");
    for (let index = 0; index < 400; index++) f.addMessage(`m-${index}`, 4096);
    f.db.exec("delete from message");
    f.addMessage("marker", 64);
    const before = await readSessionDatabaseStats(f.db, f.dbPath);
    assert.ok(before.freelistCount >= 64);

    const result = await optimizeSessionDatabase(f.db, f.dbPath, { confirm: true });
    assert.equal(result.status, "optimized");
    assert.equal(result.action, "vacuum");
    assert.ok(result.after.freelistCount < before.freelistCount);
    assert.ok(result.after.pageCount <= before.pageCount);
    assert.equal(result.after.walBytes, 0);
    assert.equal(f.db.prepare("select count(*) n from message").get()?.n, 1);
    assert.equal(f.db.prepare("select id from message where id = 'marker'").get()?.id, "marker");
  } finally {
    await f.close();
  }
});

test("low freelist skips VACUUM with an explicit reason", async () => {
  const f = await fixture();
  try {
    f.addSession("keep");
    const result = await optimizeSessionDatabase(f.db, f.dbPath, { confirm: true });
    assert.equal(result.status, "optimized");
    assert.equal(result.action, "optimize-only");
    assert.equal(result.reason, "freelist-low");
    assert.equal(result.reclaimedBytes, 0);
    assert.equal(f.db.prepare("select count(*) n from session").get()?.n, 1);
  } finally {
    await f.close();
  }
});

test("a concurrent reader refuses maintenance instead of failing or corrupting", async () => {
  const f = await fixture();
  const reader = new DatabaseSync(f.dbPath);
  try {
    f.addSession("keep");
    reader.exec("begin");
    reader.prepare("select count(*) n from session").get();
    const result = await optimizeSessionDatabase(f.db, f.dbPath, { confirm: true });
    assert.equal(result.status, "refused");
    assert.equal(result.reason, "database-busy");
    assert.equal(result.action, "none");
    assert.equal(result.before.databaseBytes, result.after.databaseBytes);
    assert.equal(f.db.prepare("select count(*) n from session").get()?.n, 1);
  } finally {
    reader.exec("rollback");
    reader.close();
    await f.close();
  }
});
