import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { buildServerRemoteWorkspaceIdentity } from "@ycode/shared";
import { sessionsIndexTopic, workspaceConfigTopic } from "@ycode/shared/ycode-protocol-v4";
import { getWorkspaceHash } from "../src/paths.js";
import { SourceServerWorkspaceAliasRepo } from "../src/session/sourceServerWorkspaceAliasRepo.js";
import { TaskIndexRepo } from "../src/session/taskIndexRepo.js";
import { runTasksDatabaseMigrations } from "../src/session/tasksDatabase/migrations.js";
import { adoptSourceServerWorkspaceSchema } from "../src/session/tasksDatabase/source-server-schema-v5.js";
import { createSourceServerWorkspaceService } from "../src/source-server-workspace/sourceServerWorkspaceService.js";
import { SourceServerWorkspaceIdentityMapper } from "../src/source-server-workspace/sourceServerWorkspaceIdentityChannelServer.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const workspacePath = "/srv/project";
const keyA = "remote:ssh:host-a.example.com:22:user:/srv/project";
const keyB = "remote:ssh:host-b.example.com:22:user:/srv/project";

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "ycode-source-workspace-"));
  roots.push(root);
  return root;
}

async function setup() {
  const root = await tempRoot();
  const taskDbPath = join(root, "tasks-index.sqlite");
  const index = new TaskIndexRepo(taskDbPath);
  await index.ensureReady();
  index.close();
  const repo = new SourceServerWorkspaceAliasRepo({
    taskDbPath,
    sessionDbPath: join(root, "missing.sqlite"),
    backupRoot: join(root, "backups"),
  });
  return { root, taskDbPath, repo };
}

async function seedVariants(taskDbPath: string) {
  const index = new TaskIndexRepo(taskDbPath);
  try {
    for (const [workspaceIdentity, taskId, updatedAt] of [
      [keyA, "task-a", 10],
      [keyB, "task-b", 20],
    ] as const) {
      await index.seedTaskMetaIfMissing({
        taskId,
        traceId: `trace-${taskId}`,
        title: taskId,
        workspacePath,
        workspaceIdentity,
        createdAt: 1,
        updatedAt,
        mode: "build",
        status: "completed",
      });
    }
  } finally {
    index.close();
  }
}

async function writeConfig(root: string, key: string, name: string, value: string) {
  const directory = join(root, "sessions", getWorkspaceHash(workspacePath, key));
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, name), value);
}

function plainRow(row: object | undefined): Record<string, unknown> | undefined {
  return row ? Object.fromEntries(Object.entries(row)) : undefined;
}

function readState(taskDbPath: string) {
  const db = new DatabaseSync(taskDbPath);
  try {
    return {
      alias: plainRow(
        db.prepare("SELECT canonical_key FROM workspace_alias WHERE path = ?").get(workspacePath),
      ),
      ledgers: db
        .prepare(
          "SELECT migration_id, canonical_key, status, phase FROM workspace_migration_ledger ORDER BY rowid",
        )
        .all()
        .map((row) => plainRow(row)),
      tasks: db
        .prepare("SELECT workspace_key, task_id FROM tasks ORDER BY task_id")
        .all()
        .map((row) => plainRow(row)),
    };
  } finally {
    db.close();
  }
}

test("schema v5 creates alias/ledger tables, records checksum and refuses future versions", async () => {
  const root = await tempRoot();
  const db = new DatabaseSync(join(root, "tasks.sqlite"));
  try {
    runTasksDatabaseMigrations(db, "source-server");
    for (const table of [
      "workspace_alias",
      "workspace_migration_ledger",
      "workspace_migration_conflicts",
      "workspace_migration_schema_version",
    ]) {
      assert.ok(
        db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table),
        table,
      );
    }
    assert.equal(
      (
        db
          .prepare(
            "SELECT version FROM workspace_migration_schema_version WHERE schema_name='workspace-migration'",
          )
          .get() as { version: number }
      ).version,
      3,
    );
    assert.ok(
      db
        .prepare(
          "SELECT 1 FROM tasks_schema_migration WHERE id='0005_source_server_workspace_schema'",
        )
        .get(),
    );
    // 幂等重跑不新增行。
    runTasksDatabaseMigrations(db, "source-server");
    assert.equal(
      (
        db
          .prepare(
            "SELECT count(*) AS n FROM tasks_schema_migration WHERE id='0005_source_server_workspace_schema'",
          )
          .get() as { n: number }
      ).n,
      1,
    );
    db.prepare(
      "UPDATE workspace_migration_schema_version SET version=4 WHERE schema_name='workspace-migration'",
    ).run();
    assert.throws(
      () => adoptSourceServerWorkspaceSchema(db),
      /newer Source Server migration schema/,
    );
  } finally {
    db.close();
  }
});

test("controller remote identity schema is recorded in the same ledger under its own scope", async () => {
  const root = await tempRoot();
  const db = new DatabaseSync(join(root, "tasks.sqlite"));
  try {
    runTasksDatabaseMigrations(db, "base");
    runTasksDatabaseMigrations(db, "controller-remote");
    assert.ok(
      db
        .prepare("SELECT 1 FROM tasks_schema_migration WHERE id='0004_controller_remote_identity'")
        .get(),
    );
    assert.ok(
      db
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type='table' AND name='controller_remote_identity_migrations'",
        )
        .get(),
    );
  } finally {
    db.close();
  }
});

test("migrated source ledger stays readable while another connection holds the write lock", async () => {
  const root = await tempRoot();
  const taskDbPath = join(root, "tasks-index.sqlite");
  const writer = new DatabaseSync(taskDbPath);
  const repo = new SourceServerWorkspaceAliasRepo({
    taskDbPath,
    sessionDbPath: join(root, "missing.sqlite"),
    backupRoot: join(root, "backups"),
  });
  try {
    writer.exec("PRAGMA journal_mode = WAL");
    assert.equal(await repo.getFailedPathCount(), 0);
    writer.exec("BEGIN IMMEDIATE");
    assert.equal(await repo.getFailedPathCount(), 0);
    assert.equal(await repo.getAbandonedPathCount(), 0);
    writer.exec("ROLLBACK");
  } finally {
    if (writer.isTransaction) writer.exec("ROLLBACK");
    writer.close();
  }
});

test("workspace service keeps first concurrent canonical response and mapper consistent", async () => {
  const { taskDbPath, repo } = await setup();
  const mapper = new SourceServerWorkspaceIdentityMapper();
  const stableIdentity = buildServerRemoteWorkspaceIdentity({
    serverId: "server-1",
    workspacePath,
  });
  const service = createSourceServerWorkspaceService(repo, {
    onResolved: ({ canonicalWorkspaceKey }) => {
      mapper.register({ stableIdentity, canonicalIdentity: canonicalWorkspaceKey });
    },
  });
  const responses = await Promise.all([
    service.resolveWorkspace({ workspacePath, legacyRouteHint: keyA }),
    service.resolveWorkspace({ workspacePath: ` ${workspacePath} `, legacyRouteHint: keyB }),
  ]);
  assert.deepEqual(
    responses.map((response) => response.canonicalWorkspaceKey),
    [keyA, keyA],
  );
  assert.deepEqual(readState(taskDbPath).alias, { canonical_key: keyA });
  assert.equal(mapper.mapIncoming(stableIdentity), keyA);
  assert.equal(mapper.mapOutgoing(keyA), stableIdentity);
  // 复合 topic 必须按协议 grammar 解析 identity，不能整串替换用户文本。
  assert.equal(mapper.mapIncoming(sessionsIndexTopic(stableIdentity)), sessionsIndexTopic(keyA));
  assert.equal(
    mapper.mapOutgoing(workspaceConfigTopic(keyA)),
    workspaceConfigTopic(stableIdentity),
  );
});

test("alias repo merges variants once, rekeys tasks and merges config directories", async () => {
  const { root, taskDbPath, repo } = await setup();
  await seedVariants(taskDbPath);
  await writeConfig(root, keyA, "a.json", "source config");
  await writeConfig(root, keyB, "b.json", "canonical config");

  const result = await repo.resolveCanonicalWorkspaceKey({
    workspacePath,
    legacyRouteHint: keyA,
  });
  assert.equal(result.canonicalKey, keyB);
  assert.deepEqual(result.mergedKeys, [keyA]);
  assert.equal(typeof result.migrationId, "string");
  assert.deepEqual(readState(taskDbPath), {
    alias: { canonical_key: keyB },
    ledgers: [
      {
        migration_id: result.migrationId,
        canonical_key: keyB,
        status: "completed",
        phase: "completed",
      },
    ],
    tasks: [
      { workspace_key: keyB, task_id: "task-a" },
      { workspace_key: keyB, task_id: "task-b" },
    ],
  });
  const canonicalDirectory = join(root, "sessions", getWorkspaceHash(workspacePath, keyB));
  assert.equal(await readFile(join(canonicalDirectory, "a.json"), "utf8"), "source config");
  assert.equal(await readFile(join(canonicalDirectory, "b.json"), "utf8"), "canonical config");

  // 已发布 alias 的后续解析不重复建 ledger。
  assert.deepEqual(await repo.resolveCanonicalWorkspaceKey({ workspacePath }), {
    canonicalKey: keyB,
    mergedKeys: [],
  });
});

test("failed preflight releases owner and retry resumes the same ledger", async () => {
  const root = await tempRoot();
  const taskDbPath = join(root, "tasks-index.sqlite");
  const index = new TaskIndexRepo(taskDbPath);
  await index.ensureReady();
  index.close();
  let failPreflight = true;
  const repo = new SourceServerWorkspaceAliasRepo({
    taskDbPath,
    sessionDbPath: join(root, "missing.sqlite"),
    backupRoot: join(root, "backups"),
    afterPhaseCommitted: (phase) => {
      if (phase === "preflight" && failPreflight) {
        failPreflight = false;
        throw new Error("interrupted before backup");
      }
    },
  });
  await seedVariants(taskDbPath);
  await assert.rejects(
    repo.resolveCanonicalWorkspaceKey({ workspacePath }),
    /interrupted before backup/,
  );
  const [failed] = readState(taskDbPath).ledgers as Array<{
    migration_id: string;
    status: string;
    phase: string;
  }>;
  assert.equal(failed?.status, "failed");
  assert.equal(failed?.phase, "preflight");

  const retried = await repo.retryFailedWorkspace(workspacePath);
  assert.equal(retried.canonicalKey, keyB);
  assert.deepEqual(retried.mergedKeys, [keyA]);
  assert.equal(retried.migrationId, failed?.migration_id);
  assert.deepEqual(readState(taskDbPath).ledgers, [
    {
      migration_id: failed?.migration_id,
      canonical_key: keyB,
      status: "completed",
      phase: "completed",
    },
  ]);
});
