import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renameSync, symlinkSync, unlinkSync } from "node:fs";
import { runSqliteSessionMigrations } from "../src/storage/session-store/migration-runner.js";
import { SessionPurgeStorage } from "../src/storage/session-store/session-purge.js";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "zcode-purge-test-"));
  const db = new DatabaseSync(join(root, "test.sqlite"));
  db.exec("pragma foreign_keys=on");
  runSqliteSessionMigrations(db, join(root, "test.sqlite"));
  const store = new SessionPurgeStorage(db, root);
  const add = (id: string, workspace = "workspace-a", parent: string | null = null) => {
    db.prepare(
      "insert into session(id,project_id,workspace_id,parent_id,slug,directory,title,version,time_created,time_updated) values(?,?,?,?,?,?,?,?,?,?)",
    ).run(id, "project", workspace, parent, id, "/workspace", id, "test", 1, 1);
    db.prepare(
      "insert into message(id,session_id,time_created,time_updated,data) values(?,?,1,1,?)",
    ).run(`m-${id}`, id, JSON.stringify({ text: "secret message".repeat(50) }));
    db.prepare(
      "insert into part(id,message_id,session_id,time_created,time_updated,data) values(?,?,?,1,1,?)",
    ).run(`p-${id}`, `m-${id}`, id, JSON.stringify({ text: "tool output" }));
    db.prepare(
      "insert into input_history(id,project_id,session_id,text,kind,time_created) values(?,?,?,?,'prompt',1)",
    ).run(`i-${id}`, "project", id, "original user input");
  };
  return {
    root,
    db,
    store,
    add,
    async close() {
      db.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}
const target = { sessionId: "one", workspaceKey: "workspace-a" };
test("purge preview is read-only; confirmed purge removes owned data and files, preserving neighbors", async () => {
  const f = await fixture();
  try {
    f.add("one");
    f.add("two");
    const dir = join(f.root, "cli", "sessions", "one");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "work.txt"), "owned payload");
    const preview = await f.store.preview(target);
    assert.equal(preview.state, "present");
    assert.equal(preview.ownedFileBytes, 13);
    assert.ok(preview.logicalBytes > 700);
    assert.equal(f.db.prepare("select count(*) n from message").get()?.n, 2);
    const result = await f.store.purge({
      ...target,
      expectedRevision: preview.revision,
      confirmPermanent: true,
    });
    assert.equal(result.state, "purged");
    assert.equal(result.removedFileBytes, 13);
    for (const table of ["message", "part", "input_history"])
      assert.equal(
        f.db.prepare(`select count(*) n from ${table} where session_id='one'`).get()?.n,
        0,
      );
    assert.ok(f.db.prepare("select id from session where id='two'").get());
    assert.throws(() => f.add("one"), /permanently_deleted/);
    assert.equal(
      (
        await f.store.purge({
          ...target,
          expectedRevision: preview.revision,
          confirmPermanent: true,
        })
      ).state,
      "purged",
    );
  } finally {
    await f.close();
  }
});
test("scope mismatch, dependent sessions and stale previews cannot remove data", async () => {
  const f = await fixture();
  try {
    f.add("one");
    const before = await f.store.preview(target);
    assert.ok(
      (await f.store.preview({ ...target, workspaceKey: "other" })).blockers.includes(
        "workspace-mismatch",
      ),
    );
    f.add("child", "workspace-a", "one");
    assert.ok((await f.store.preview(target)).blockers.includes("dependent-session"));
    await assert.rejects(
      f.store.purge({ ...target, expectedRevision: before.revision, confirmPermanent: true }),
    );
    f.db.prepare("delete from session where id='child'").run();
    f.db.prepare("update message set data=? where session_id='one'").run('{"text":"changed"}');
    await assert.rejects(
      f.store.purge({ ...target, expectedRevision: before.revision, confirmPermanent: true }),
      /stale/,
    );
    assert.ok(f.db.prepare("select id from session where id='one'").get());
  } finally {
    await f.close();
  }
});
test("failed SQL rolls back the purge ledger and original messages", async () => {
  const f = await fixture();
  try {
    f.add("one");
    const preview = await f.store.preview(target);
    f.db.exec(
      "create trigger reject_purge before delete on session begin select raise(abort,'injected'); end",
    );
    await assert.rejects(
      f.store.purge({ ...target, expectedRevision: preview.revision, confirmPermanent: true }),
      /injected/,
    );
    assert.equal(f.db.prepare("select count(*) n from session_purge").get()?.n, 0);
    assert.equal(f.db.prepare("select count(*) n from message").get()?.n, 1);
  } finally {
    await f.close();
  }
});
test("unsafe session paths and junctions cannot delete files outside the owned root", async () => {
  const f = await fixture();
  try {
    f.add("one");
    await mkdir(join(f.root, "outside"));
    await writeFile(join(f.root, "outside", "keep.txt"), "keep");
    await mkdir(join(f.root, "cli", "sessions"), { recursive: true });
    await symlink(join(f.root, "outside"), join(f.root, "cli", "sessions", "one"), "junction");
    const preview = await f.store.preview(target);
    assert.ok(preview.blockers.includes("unsafe-file"));
    await assert.rejects(
      f.store.purge({ ...target, expectedRevision: preview.revision, confirmPermanent: true }),
    );
    assert.equal(await readFile(join(f.root, "outside", "keep.txt"), "utf8"), "keep");
    assert.ok((await stat(join(f.root, "outside"))).isDirectory());
  } finally {
    await f.close();
  }
});

test("pending inputs, workflow dependencies and shared files block deletion", async () => {
  const f = await fixture();
  try {
    f.add("one");
    f.add("two");
    f.db
      .prepare(
        "insert into session_input(id,session_id,kind,delivery,payload,admitted_sequence,status,time_created,time_updated) values('q','one','prompt','queue','{}',1,'admitted',1,1)",
      )
      .run();
    assert.ok((await f.store.preview(target)).blockers.includes("pending-input"));
    f.db.exec("update session_input set status='discarded'");
    f.db.exec(
      "insert into dwf_run(id,parent_session_id,caps_max_concurrency,status,time_created,time_updated) values('w','one',1,'completed',1,1)",
    );
    assert.ok((await f.store.preview(target)).blockers.includes("workflow-reference"));
    f.db.exec("delete from dwf_run");
    const directory = join(f.root, "cli", "sessions", "one");
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "output.txt"), "shared");
    f.db
      .prepare("update part set data=? where session_id='two'")
      .run(JSON.stringify({ path: join(directory, "output.txt") }));
    assert.ok((await f.store.preview(target)).blockers.includes("shared-file"));
    await assert.rejects(
      f.store.purge({
        ...target,
        expectedRevision: (await f.store.preview(target)).revision,
        confirmPermanent: true,
      }),
      /shared-file/,
    );
    f.db.prepare("update part set data='{}' where session_id='two'").run();
    f.db
      .prepare(
        "insert into session_input(id,session_id,kind,delivery,payload,admitted_sequence,status,time_created,time_updated) values('other-input','two','prompt','queue',?,1,'admitted',1,1)",
      )
      .run(JSON.stringify({ path: join(directory, "output.txt") }));
    assert.ok((await f.store.preview(target)).blockers.includes("shared-file"));
  } finally {
    await f.close();
  }
});

test("file cleanup failure survives restart and retries without deleting neighbors", async () => {
  const f = await fixture();
  try {
    f.add("one");
    const owned = join(f.root, "cli", "sessions", "one"),
      moved = join(f.root, "held");
    await mkdir(owned, { recursive: true });
    await writeFile(join(owned, "output.txt"), "payload");
    const preview = await f.store.preview(target);
    // 模拟事务提交后文件系统范围变化；新 junction 必须拒绝，清单仍可重启恢复。
    f.db.function("replace_owned", () => {
      renameSync(owned, moved);
      symlinkSync(moved, owned, "junction");
      return 1;
    });
    f.db.exec(
      "create trigger replace_files after delete on session begin select replace_owned(); end",
    );
    const first = await f.store.purge({
      ...target,
      expectedRevision: preview.revision,
      confirmPermanent: true,
    });
    assert.equal(first.state, "cleanup-pending");
    assert.equal(first.pendingFileCount, 1);
    assert.equal(f.db.prepare("select count(*) n from message").get()?.n, 0);
    assert.equal(await readFile(join(moved, "output.txt"), "utf8"), "payload");
    unlinkSync(owned);
    renameSync(moved, owned);
    const reopened = new DatabaseSync(join(f.root, "test.sqlite"));
    try {
      const store = new SessionPurgeStorage(reopened, f.root);
      assert.equal((await store.preview(target)).state, "cleanup-pending");
      await assert.rejects(
        store.purge({
          ...target,
          workspaceKey: "other",
          expectedRevision: preview.revision,
          confirmPermanent: true,
        }),
        /workspace-mismatch/,
      );
      const result = await store.purge({
        ...target,
        expectedRevision: preview.revision,
        confirmPermanent: true,
      });
      assert.equal(result.state, "purged");
      assert.equal(result.removedFileBytes, 7);
      assert.ok(result.databaseFreeBytes >= 0);
      assert.throws(
        () =>
          reopened
            .prepare(
              "insert into input_history(id,project_id,session_id,text,kind,time_created) values('late','project','one','late','prompt',1)",
            )
            .run(),
        /permanently_deleted/,
      );
    } finally {
      reopened.close();
    }
  } finally {
    await f.close();
  }
});
