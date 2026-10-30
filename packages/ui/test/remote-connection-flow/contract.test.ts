import assert from "node:assert/strict";
import { it } from "node:test";
import { normalizeRemoteConnectionOptions } from "../../src/remote-connection-flow/contract.js";
import { projectConnectionOptions } from "../../src/remote-connection-flow/contract.example.js";
it("项目接管保持回调与显式入口身份，默认不打开向导", async () => {
  const calls = { select: 0, ready: 0 };
  const options = normalizeRemoteConnectionOptions({
    ...projectConnectionOptions(
      {
        onConnect: async () => "connection",
        onCancelSession: async () => {},
        onSelectProject: async () => {
          calls.select += 1;
        },
      },
      async () => {
        calls.ready += 1;
      },
    ),
    openIntentId: 3,
  });
  assert.equal(options.controlledOpen, undefined);
  assert.deepEqual(options.remoteWorkspaceSessions, []);
  assert.equal(options.openIntentId, 3);
  await options.onConnectionReady?.("connection");
  assert.equal(calls.ready, 1);
  assert.equal(calls.select, 0);
});
