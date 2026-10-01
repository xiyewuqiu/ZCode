import assert from "node:assert/strict";
import { test } from "node:test";
import { useTaskStorageDialogStore } from "../src/store/taskStorageDialogStore.js";

test("opening another session replaces the pending target instead of queueing a second dialog", () => {
  const store = useTaskStorageDialogStore;
  assert.equal(store.getState().request, null);

  store.getState().open({ taskId: "a", workspacePath: "/w1", title: "A" });
  assert.deepEqual(store.getState().request, { taskId: "a", workspacePath: "/w1", title: "A" });

  store.getState().open({
    taskId: "b",
    workspacePath: "/w2",
    workspaceIdentity: "ssh-1",
    remoteSessionId: "session-9",
    title: "B",
  });
  // 远端身份字段必须原样保留：Host 路由依赖它们，补齐才能保证删除不会落到本机。
  assert.deepEqual(store.getState().request, {
    taskId: "b",
    workspacePath: "/w2",
    workspaceIdentity: "ssh-1",
    remoteSessionId: "session-9",
    title: "B",
  });

  store.getState().close();
  assert.equal(store.getState().request, null);
});
