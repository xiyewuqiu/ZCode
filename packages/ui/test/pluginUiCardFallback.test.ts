import assert from "node:assert/strict";
import test from "node:test";
import {
  formatPluginUiFallbackReason,
  parsePluginUiJson,
  readPluginUiDisplay,
  readPluginUiPreview,
  resolvePluginUiHostUnavailableReason,
  type PluginUiDisplay,
} from "../src/plugin-ui/domain/contract.js";

test("PluginUiCard fallback selects no-platform / no-host / no-session before prepare", () => {
  assert.equal(
    resolvePluginUiHostUnavailableReason({
      hasPlatform: false,
      hasHost: false,
      hasLegacyLoader: false,
      canRegisterSandbox: false,
    }),
    "no-platform",
  );
  assert.equal(
    resolvePluginUiHostUnavailableReason({
      hasPlatform: true,
      hasHost: false,
      hasLegacyLoader: false,
      canRegisterSandbox: true,
      sessionId: "session-1",
    }),
    "no-host",
  );
  // 只有 loader、平台又不能登记沙箱时仍然没有宿主端口。
  assert.equal(
    resolvePluginUiHostUnavailableReason({
      hasPlatform: true,
      hasHost: false,
      hasLegacyLoader: true,
      canRegisterSandbox: false,
      sessionId: "session-1",
    }),
    "no-host",
  );
  assert.equal(
    resolvePluginUiHostUnavailableReason({
      hasPlatform: true,
      hasHost: true,
      hasLegacyLoader: false,
      canRegisterSandbox: true,
    }),
    "no-session",
  );
  // legacy loader + 可登记沙箱 = 兼容宿主可用。
  assert.equal(
    resolvePluginUiHostUnavailableReason({
      hasPlatform: true,
      hasHost: false,
      hasLegacyLoader: true,
      canRegisterSandbox: true,
      sessionId: "session-1",
    }),
    null,
  );
  assert.equal(
    resolvePluginUiHostUnavailableReason({
      hasPlatform: true,
      hasHost: true,
      hasLegacyLoader: false,
      canRegisterSandbox: true,
      sessionId: "session-1",
    }),
    null,
  );
});

test("fallback reason keeps the short code and appends the host error text", () => {
  assert.equal(formatPluginUiFallbackReason("no-host", undefined), "no-host");
  assert.equal(formatPluginUiFallbackReason(undefined, undefined), "error");
  assert.equal(
    formatPluginUiFallbackReason("bridge-failed", "handshake timed out"),
    "bridge-failed: handshake timed out",
  );
});

test("fallback summary reads display.ui defensively and prefers structured content", () => {
  assert.equal(readPluginUiDisplay(undefined), null);
  assert.equal(readPluginUiDisplay({ kind: "other" }), null);
  assert.equal(
    readPluginUiDisplay({ kind: "mcp_tool", ui: { pluginId: "plugin", resourceUri: "https://x" } }),
    null,
  );

  const display = readPluginUiDisplay({
    kind: "mcp_tool",
    ui: {
      pluginId: "plugin-1",
      resourceUri: "ui://app",
      preferredDisplayMode: "pip",
      structuredContent: '{"ok":true}',
      content: "raw",
    },
  });
  assert.ok(display);
  assert.equal(display.resourceUri, "ui://app");
  assert.equal(display.preferredDisplayMode, "pip");

  assert.equal(readPluginUiPreview(display), '{"ok":true}');
  assert.equal(
    readPluginUiPreview({ resourceUri: "ui://app", pluginId: "plugin-1", content: "raw" }),
    "raw",
  );
  assert.deepEqual(parsePluginUiJson('{"ok":true}'), { ok: true });
  assert.equal(parsePluginUiJson("{not-json"), undefined);
  assert.equal(parsePluginUiJson(undefined), undefined);
});

test("fallback display preserves the surface and CSP needed for later retries", () => {
  const display: PluginUiDisplay = {
    pluginId: "plugin-1",
    resourceUri: "ui://app",
    surface: "composer",
    csp: { connectDomains: ["https://api.example.com"] },
    prefersBorder: true,
    showInline: true,
  };
  const parsed = readPluginUiDisplay({ kind: "mcp_tool", ui: display });
  assert.equal(parsed?.surface, "composer");
  assert.deepEqual(parsed?.csp, { connectDomains: ["https://api.example.com"] });
  assert.equal(parsed?.prefersBorder, true);
  assert.equal(parsed?.showInline, true);
});
