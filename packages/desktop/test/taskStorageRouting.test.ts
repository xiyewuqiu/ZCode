import assert from "node:assert/strict";
import test from "node:test";
import type { IZCodeTaskService } from "@zcode/services";
import { createWindowHostControllerRuntime } from "../src/host/windowHostControllerService.js";

test("storage confirmation binds to the remote source; replaced/offline sources cannot receive deletion", async () => {
  let remoteSessionId = "remote-a",
    offline = false,
    calls = 0,
    refreshFailure = false;
  const taskService = {
    listTasks: async () => {
      if (refreshFailure) throw new Error("refresh failed");
      return [];
    },
    listPinnedTasks: async () => [],
    listArchivedTasks: async () => [],
    previewTaskStorage: async () => ({
      sessionId: "one",
      revision: "revision",
      state: "present",
      logicalBytes: 1,
      recordCount: 1,
      ownedFileBytes: 0,
      ownedFileCount: 0,
      blockers: [],
    }),
    purgeTaskStorage: async (params: Parameters<IZCodeTaskService["purgeTaskStorage"]>[0]) => {
      assert.equal(params.expectedRevision, "revision");
      assert.equal(params.workspaceIdentity, "remote-workspace");
      calls++;
      refreshFailure = true;
      return {
        sessionId: "one",
        state: "purged",
        deletedRecords: 1,
        deletedLogicalBytes: 1,
        removedFileBytes: 0,
        pendingFileCount: 0,
        databaseFreeBytes: 0,
      };
    },
  } as unknown as IZCodeTaskService;
  const runtime = createWindowHostControllerRuntime({
    createId: () => "test-id",
    resolveSource: () => ({
      scope: {
        kind: "remote",
        remoteSessionId,
        workspaceIdentity: "remote-workspace",
        workspacePath: "/workspace",
      },
      taskService,
      sourceAvailability: offline ? "offline" : "online",
    }),
  });
  const target = {
    workspacePath: "/workspace",
    workspaceIdentity: "remote-workspace",
    taskId: "one",
    allowMissingTask: true,
  };
  try {
    const address = await runtime.resolveTaskAddress(target);
    const preview = await runtime.service.previewTaskStorage({ address });
    remoteSessionId = "remote-b";
    const replacement = await runtime.resolveTaskAddress(target);
    await assert.rejects(
      runtime.service.purgeTaskStorage({
        address: replacement,
        expectedRevision: preview.revision,
        confirmPermanent: true,
      }),
      /source_changed/,
    );
    await assert.rejects(
      runtime.service.purgeTaskStorage({
        address,
        expectedRevision: preview.revision,
        confirmPermanent: true,
      }),
      /source_changed/,
    );
    assert.equal(calls, 0);
    const latest = await runtime.service.previewTaskStorage({ address: replacement });
    offline = true;
    await assert.rejects(
      runtime.service.purgeTaskStorage({
        address: replacement,
        expectedRevision: latest.revision,
        confirmPermanent: true,
      }),
    );
    assert.equal(calls, 0);
    offline = false;
    const result = await runtime.service.purgeTaskStorage({
      address: replacement,
      expectedRevision: latest.revision,
      confirmPermanent: true,
    });
    assert.equal(result.state, "purged");
    assert.equal(calls, 1);
  } finally {
    runtime.service.dispose?.();
    runtime.dispose();
  }
});
