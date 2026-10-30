import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import type { AutoArchiveInput } from "../src/project-storage/contract.js";
import type { ProjectTaskRef } from "../src/project/contract.js";
import {
  createTaskAutoArchiveScheduler,
  shouldRescanTaskAutoArchive,
} from "../src/project/autoArchiveScheduler.js";

const policy: AutoArchiveInput = { cutoff: 100, activeTasks: [] };
const stale: ProjectTaskRef = { workspacePath: "/cwd", taskId: "stale" };

test("scans once on start and then on every interval until disposed", async () => {
  let scans = 0;
  const scheduler = createTaskAutoArchiveScheduler({
    readPolicy: async () => policy,
    repository: async () => ({
      archiveInactive: () => {
        scans += 1;
        return [];
      },
    }),
    afterChange: async () => {},
    intervalMs: 5,
  });
  scheduler.start();
  scheduler.start();
  await delay(40);
  const afterStart = scans;
  assert.equal(afterStart >= 2, true);
  scheduler.dispose();
  await delay(30);
  assert.equal(scans, afterStart);
  assert.deepEqual(await scheduler.scan(), []);
  assert.equal(scans, afterStart);
});

test("skips the repository when the policy is disabled and broadcasts only actual changes", async () => {
  let enabled = false;
  let archiveCalls = 0;
  let changes = 0;
  let next: ProjectTaskRef[] = [];
  const scheduler = createTaskAutoArchiveScheduler({
    readPolicy: async () => (enabled ? policy : null),
    repository: async () => ({
      archiveInactive: () => {
        archiveCalls += 1;
        return next;
      },
    }),
    afterChange: async () => {
      changes += 1;
    },
    intervalMs: 60_000,
  });
  assert.deepEqual(await scheduler.scan(), []);
  assert.equal(archiveCalls, 0);
  enabled = true;
  assert.deepEqual(await scheduler.scan(), []);
  assert.equal(archiveCalls, 1);
  assert.equal(changes, 0);
  next = [stale];
  assert.deepEqual(await scheduler.scan(), [stale]);
  assert.equal(changes, 1);
  scheduler.dispose();
});

test("serializes overlapping scans and coalesces waiters into one follow-up scan", async () => {
  const release: Array<() => void> = [];
  let archiveCalls = 0;
  const scheduler = createTaskAutoArchiveScheduler({
    readPolicy: () =>
      new Promise<AutoArchiveInput>((resolve) => release.push(() => resolve(policy))),
    repository: async () => ({
      archiveInactive: () => {
        archiveCalls += 1;
        return archiveCalls === 2 ? [stale] : [];
      },
    }),
    afterChange: async () => {},
    intervalMs: 60_000,
  });
  const first = scheduler.scan();
  const second = scheduler.scan();
  const third = scheduler.scan();
  assert.equal(third, second);
  assert.equal(release.length, 1);
  release[0]!();
  await first;
  assert.equal(archiveCalls, 1);
  await delay(0);
  assert.equal(release.length, 2);
  release[1]!();
  assert.deepEqual(await second, [stale]);
  assert.equal(archiveCalls, 2);
  scheduler.dispose();
});

test("only rescans for the two auto archive setting keys", () => {
  assert.equal(shouldRescanTaskAutoArchive(["taskAutoArchiveEnabled"]), true);
  assert.equal(shouldRescanTaskAutoArchive(["theme", "taskAutoArchiveOlderThanDays"]), true);
  assert.equal(shouldRescanTaskAutoArchive(["theme", "recentProjects"]), false);
  assert.equal(shouldRescanTaskAutoArchive([]), false);
});
