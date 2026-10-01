import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { TaskIndexRepo } from "../src/session/taskIndexRepo.js";

test("permanent deletion clears search and metadata; late sync cannot refill; pending cleanup remains retryable", async () => {
  const root = await mkdtemp(join(tmpdir(), "zcode-index-purge-"));
  const path = join(root, "tasks.sqlite"),
    repo = new TaskIndexRepo(path);
  const target = { taskId: "one", workspacePath: "/workspace/example" };
  const meta = {
    ...target,
    traceId: "trace-one",
    title: "private title",
    mode: "build" as const,
    provider: "glm" as const,
    createdAt: 1,
    updatedAt: 2,
  };
  try {
    await repo.syncTaskMeta({
      meta,
      archived: true,
      searchableText: "private conversation content",
    });
    await repo.syncTaskMeta({ meta: { ...meta, taskId: "two" }, searchableText: "neighbor" });
    assert.equal(await repo.hasTaskStorageReferences(target), false);
    await repo.purgeTaskContent({ ...target, cleanupPending: true });
    await repo.syncTaskMeta({ meta, archived: false, searchableText: "late private content" });
    const db = new DatabaseSync(path);
    try {
      const row = db.prepare("select * from tasks where task_id='one'").get()!;
      assert.equal(row.title, "");
      assert.equal(row.searchable_text, "");
      assert.equal(String(row.meta_json).includes("private"), false);
      assert.equal(row.archived, 1);
      assert.equal(row.deleted, 0);
      assert.equal(
        db.prepare("select searchable_text from tasks where task_id='two'").get()?.searchable_text,
        "neighbor",
      );
      await repo.purgeTaskContent({ ...target, cleanupPending: false });
      await repo.purgeTaskContent({ ...target, cleanupPending: false });
      assert.equal(db.prepare("select deleted from tasks where task_id='one'").get()?.deleted, 1);
      await repo.syncTaskMeta({ meta, deleted: false, searchableText: "late again" });
      assert.equal(db.prepare("select deleted from tasks where task_id='one'").get()?.deleted, 1);
    } finally {
      db.close();
    }
  } finally {
    repo.close();
    await rm(root, { recursive: true, force: true });
  }
});
