import assert from "node:assert/strict";
import test from "node:test";
import type { McpAppsResourcePermission } from "@ycode/shared/mcp-apps";
import {
  buildPluginSandboxPluginOrigin,
  buildPluginSandboxShellUrl,
} from "../src/main/pluginSandbox/contract.js";
import { createPluginSandboxPermissionGate } from "../src/main/pluginSandbox/permissionGate.js";
import {
  decidePluginSandboxPermission,
  formatPluginSandboxPermissionDialogText,
  isPluginSandboxPermissionGranted,
  readPluginSandboxIdFromPluginUrl,
  resolvePluginSandboxCheckedPermission,
  resolvePluginSandboxRequestedPermissions,
} from "../src/main/pluginSandbox/permissions.js";
import { createPluginSandboxRegistry } from "../src/main/pluginSandbox/registry.js";
import type { PluginSandboxRegisterInput } from "../src/main/pluginSandbox/contract.js";

const APP_IDENTITY = "c".repeat(64);

function register(
  registry: ReturnType<typeof createPluginSandboxRegistry>,
  permissions: McpAppsResourcePermission[],
) {
  const input: PluginSandboxRegisterInput = {
    instance: {
      runtimeId: "runtime-1",
      generation: 1,
      token: "token-1",
      appIdentity: APP_IDENTITY,
    },
    ownerWebContentsId: 7,
    sessionId: "session-1",
    pluginId: "plugin-1",
    serverName: "srv",
    scopeId: "tool:call-1",
    html: "<html></html>",
    permissions,
  };
  const handle = registry.register(input);
  const record = registry.get(handle.sandboxId);
  assert.ok(record);
  return record;
}

test("Electron permission names map to the four MCP Apps permissions", () => {
  assert.deepEqual(resolvePluginSandboxRequestedPermissions("geolocation", undefined), [
    "geolocation",
  ]);
  assert.deepEqual(resolvePluginSandboxRequestedPermissions("clipboard-write", undefined), [
    "clipboardWrite",
  ]);
  assert.deepEqual(
    resolvePluginSandboxRequestedPermissions("clipboard-sanitized-write", undefined),
    ["clipboardWrite"],
  );
  assert.deepEqual(resolvePluginSandboxRequestedPermissions("media", { mediaTypes: ["video"] }), [
    "camera",
  ]);
  assert.deepEqual(resolvePluginSandboxRequestedPermissions("media", { mediaTypes: ["audio"] }), [
    "microphone",
  ]);
  assert.deepEqual(
    resolvePluginSandboxRequestedPermissions("media", { mediaTypes: ["audio", "video"] }),
    ["camera", "microphone"],
  );
  assert.deepEqual(resolvePluginSandboxRequestedPermissions("media", undefined), [
    "camera",
    "microphone",
  ]);
  assert.equal(resolvePluginSandboxRequestedPermissions("notifications", undefined), null);

  assert.equal(resolvePluginSandboxCheckedPermission("media", { mediaType: "video" }), "camera");
  assert.equal(
    resolvePluginSandboxCheckedPermission("media", { mediaType: "audio" }),
    "microphone",
  );
  assert.equal(resolvePluginSandboxCheckedPermission("media", {}), null);
  assert.equal(resolvePluginSandboxCheckedPermission("geolocation", undefined), "geolocation");
});

test("permission decisions deny undeclared keys and prompt only for prompted permissions", () => {
  assert.deepEqual(
    decidePluginSandboxPermission({ requested: [], declared: [], consented: new Set() }),
    { decision: "deny", pending: [] },
  );
  assert.deepEqual(
    decidePluginSandboxPermission({
      requested: ["camera"],
      declared: ["microphone"],
      consented: new Set(),
    }),
    { decision: "deny", pending: [] },
  );
  assert.deepEqual(
    decidePluginSandboxPermission({
      requested: ["camera"],
      declared: ["camera"],
      consented: new Set(),
    }),
    { decision: "prompt", pending: ["camera"] },
  );
  assert.deepEqual(
    decidePluginSandboxPermission({
      requested: ["camera"],
      declared: ["camera"],
      consented: new Set(["camera"]),
    }),
    { decision: "allow", pending: [] },
  );
  // clipboardWrite 按声明放行，不需要确认。
  assert.deepEqual(
    decidePluginSandboxPermission({
      requested: ["clipboardWrite"],
      declared: ["clipboardWrite"],
      consented: new Set(),
    }),
    { decision: "allow", pending: [] },
  );

  assert.equal(
    isPluginSandboxPermissionGranted({
      permission: "clipboardWrite",
      declared: ["clipboardWrite"],
      consented: new Set(),
    }),
    true,
  );
  assert.equal(
    isPluginSandboxPermissionGranted({
      permission: "camera",
      declared: ["camera"],
      consented: new Set(),
    }),
    false,
  );
  assert.equal(
    isPluginSandboxPermissionGranted({
      permission: "camera",
      declared: [],
      consented: new Set(["camera"]),
    }),
    false,
  );
});

test("only plugin-origin frames under an instance path can own a permission", () => {
  assert.equal(
    readPluginSandboxIdFromPluginUrl(
      `${buildPluginSandboxPluginOrigin(APP_IDENTITY)}/instance/sb-test/index.html`,
    ),
    "sb-test",
  );
  assert.equal(
    readPluginSandboxIdFromPluginUrl(buildPluginSandboxShellUrl("sb-test", APP_IDENTITY)),
    null,
  );
  assert.equal(readPluginSandboxIdFromPluginUrl("https://plugin-x/instance/sb-test/"), null);
  assert.equal(readPluginSandboxIdFromPluginUrl(undefined), null);
});

test("permission dialog text is localized", () => {
  const zh = formatPluginSandboxPermissionDialogText(
    { serverName: "srv", permissions: ["camera", "microphone"] },
    "zh-CN",
  );
  assert.equal(zh.title, "应用权限请求");
  assert.match(zh.message, /srv/);
  assert.match(zh.message, /摄像头、麦克风/);
  const en = formatPluginSandboxPermissionDialogText(
    { serverName: "srv", permissions: ["geolocation"] },
    "en-US",
  );
  assert.equal(en.title, "App permission request");
  assert.match(en.message, /location/);
});

test("permission gate prompts once per partition + permission set and remembers consent", async () => {
  const registry = createPluginSandboxRegistry();
  const record = register(registry, ["camera"]);
  const prompts: string[][] = [];
  const gate = createPluginSandboxPermissionGate({
    registry,
    async prompt({ permissions }) {
      prompts.push([...permissions]);
      return true;
    },
  });
  const requestBase = {
    guestUrl: record.shellUrl,
    requestingUrl: buildPluginSandboxPluginOrigin(APP_IDENTITY),
    isCurrent: () => true,
  };

  assert.equal(
    await gate.request({ ...requestBase, permission: "media", mediaTypes: ["video"] }),
    true,
  );
  assert.deepEqual(prompts, [["camera"]]);
  assert.equal(
    await gate.request({ ...requestBase, permission: "media", mediaTypes: ["video"] }),
    true,
  );
  assert.equal(prompts.length, 1);
  // 未声明的麦克风仍然拒绝。
  assert.equal(
    await gate.request({ ...requestBase, permission: "media", mediaTypes: ["audio"] }),
    false,
  );
  assert.equal(prompts.length, 1);

  assert.equal(
    gate.check({
      guestUrl: record.shellUrl,
      permission: "media",
      requestingOrigin: buildPluginSandboxPluginOrigin(APP_IDENTITY),
      mediaType: "video",
    }),
    true,
  );
  assert.equal(
    gate.check({
      guestUrl: record.shellUrl,
      permission: "media",
      requestingOrigin: buildPluginSandboxPluginOrigin(APP_IDENTITY),
      mediaType: "audio",
    }),
    false,
  );
});

test("permission gate denies shell-origin requests, stale guests and undeclared keys", async () => {
  const registry = createPluginSandboxRegistry();
  const record = register(registry, ["camera"]);
  let promptCount = 0;
  const gate = createPluginSandboxPermissionGate({
    registry,
    async prompt() {
      promptCount += 1;
      return true;
    },
  });
  const guestOrigin = buildPluginSandboxPluginOrigin(APP_IDENTITY);

  assert.equal(
    await gate.request({
      permission: "media",
      mediaTypes: ["video"],
      guestUrl: record.shellUrl,
      requestingUrl: record.shellUrl,
      isCurrent: () => true,
    }),
    false,
  );
  assert.equal(
    await gate.request({
      permission: "media",
      mediaTypes: ["video"],
      guestUrl: record.shellUrl,
      requestingUrl: guestOrigin,
      isCurrent: () => false,
    }),
    false,
  );
  assert.equal(
    await gate.request({
      permission: "notifications",
      guestUrl: record.shellUrl,
      requestingUrl: guestOrigin,
      isCurrent: () => true,
    }),
    false,
  );
  assert.equal(promptCount, 0);

  registry.dispose(record.sandboxId);
  assert.equal(
    await gate.request({
      permission: "media",
      mediaTypes: ["video"],
      guestUrl: record.shellUrl,
      requestingUrl: guestOrigin,
      isCurrent: () => true,
    }),
    false,
  );
});

test("permission gate re-prompts when system media access was denied", async () => {
  const registry = createPluginSandboxRegistry();
  const record = register(registry, ["camera"]);
  let promptCount = 0;
  const gate = createPluginSandboxPermissionGate({
    registry,
    async prompt() {
      promptCount += 1;
      return true;
    },
    async requestSystemMediaAccess() {
      return false;
    },
  });

  assert.equal(
    await gate.request({
      permission: "media",
      mediaTypes: ["video"],
      guestUrl: record.shellUrl,
      requestingUrl: buildPluginSandboxPluginOrigin(APP_IDENTITY),
      isCurrent: () => true,
    }),
    false,
  );
  assert.equal(promptCount, 1);
  // 系统授权失败不记录同意，下一次仍要确认。
  await gate.request({
    permission: "media",
    mediaTypes: ["video"],
    guestUrl: record.shellUrl,
    requestingUrl: buildPluginSandboxPluginOrigin(APP_IDENTITY),
    isCurrent: () => true,
  });
  assert.equal(promptCount, 2);
});

test("concurrent permission requests share one prompt", async () => {
  const registry = createPluginSandboxRegistry();
  const record = register(registry, ["camera"]);
  let promptCount = 0;
  let resolvePrompt: ((allowed: boolean) => void) | undefined;
  const prompt = new Promise<boolean>((resolve) => {
    resolvePrompt = resolve;
  });
  const gate = createPluginSandboxPermissionGate({
    registry,
    prompt() {
      promptCount += 1;
      return prompt;
    },
  });
  const request = () =>
    gate.request({
      permission: "media",
      mediaTypes: ["video"],
      guestUrl: record.shellUrl,
      requestingUrl: buildPluginSandboxPluginOrigin(APP_IDENTITY),
      isCurrent: () => true,
    });

  const first = request();
  const second = request();
  assert.equal(promptCount, 1);
  resolvePrompt?.(true);
  assert.deepEqual(await Promise.all([first, second]), [true, true]);
});
