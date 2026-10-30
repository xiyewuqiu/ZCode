import assert from "node:assert/strict";
import test from "node:test";
import { Emitter } from "@ycode/rpc";
import { createWindowProjectChangesService } from "../src/window-project-directory/index.js";

test("window change stream forwards only project invalidation and releases its listener", async () => {
  const event = new Emitter<{ channel: string; payload: unknown }>();
  const service = createWindowProjectChangesService({ onMessage: event.event });
  let changes = 0;
  const subscription = service.onDidChange(() => {
    changes += 1;
  });
  assert.deepEqual(await service.getCapabilities(), { version: 1 });
  event.fire({ channel: "state:theme", payload: {} });
  assert.equal(changes, 0);
  event.fire({ channel: "state:projects", payload: {} });
  assert.equal(changes, 1);
  subscription.dispose();
  event.fire({ channel: "state:projects", payload: {} });
  assert.equal(changes, 1);
  event.dispose();
});
