import assert from "node:assert/strict";
import test from "node:test";
import {
  PLUGIN_SANDBOX_PERMISSIONS_POLICY,
  buildPluginSandboxCsp,
  buildPluginSandboxPermissionsPolicy,
  buildPluginSandboxShellCsp,
} from "../src/main/pluginSandbox/csp.js";
import type { PluginSandboxRegisterInput } from "../src/main/pluginSandbox/contract.js";
import {
  buildPluginSandboxPluginOrigin,
  buildPluginSandboxPluginUrl,
  buildPluginSandboxShellUrl,
} from "../src/main/pluginSandbox/contract.js";
import {
  createPluginSandboxProtocolHandler,
  parsePluginSandboxUrl,
} from "../src/main/pluginSandbox/protocol.js";
import { createPluginSandboxRegistry } from "../src/main/pluginSandbox/registry.js";

const APP_IDENTITY = "a".repeat(64);

function registerInput(): PluginSandboxRegisterInput {
  return {
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
    html: "<html><body>plugin</body></html>",
    csp: {
      connectDomains: [
        "https://api.example.com",
        "https://api.example.com/ignored-path",
        "wss://socket.example.com",
        "http://insecure.example.com",
      ],
    },
    cspRelaxations: { unsafeEval: true },
    permissions: ["camera", "clipboardWrite"],
  };
}

function createHandler() {
  const registry = createPluginSandboxRegistry({ createId: () => "sb-test" });
  const handle = registry.register(registerInput());
  const record = registry.get(handle.sandboxId);
  assert.ok(record);
  return {
    registry,
    handle,
    record,
    handler: createPluginSandboxProtocolHandler({ registry }),
  };
}

test("plugin CSP is strict by default and only relaxes eval flags explicitly declared", () => {
  const base = {
    sandboxId: "sb-test",
    appIdentity: APP_IDENTITY,
  };
  const strict = buildPluginSandboxCsp(base);
  assert.match(strict, /default-src 'none'/);
  assert.match(strict, /script-src 'self' 'unsafe-inline' blob: data:/);
  assert.doesNotMatch(strict, /'unsafe-eval'/);
  assert.doesNotMatch(strict, /'wasm-unsafe-eval'/);

  const relaxed = buildPluginSandboxCsp({
    ...base,
    cspRelaxations: { unsafeEval: true, wasmUnsafeEval: true },
  });
  assert.match(relaxed, /'unsafe-eval'/);
  assert.match(relaxed, /'wasm-unsafe-eval'/);

  assert.throws(() => buildPluginSandboxCsp({ ...base, sandboxId: "bad_id" }), /host-safe/);
  assert.throws(() => buildPluginSandboxCsp({ ...base, appIdentity: "short" }), /sha256/);
});

test("resource origins are normalized, deduped, and wired into the matching CSP directives", () => {
  const header = buildPluginSandboxCsp({
    sandboxId: "sb-test",
    appIdentity: APP_IDENTITY,
    csp: {
      connectDomains: ["https://api.example.com/path", "https://api.example.com"],
      resourceDomains: ["https://cdn.example.com"],
      frameDomains: ["https://frames.example.com"],
      baseUriDomains: ["https://base.example.com"],
    },
  });
  assert.match(header, /connect-src https:\/\/api\.example\.com;/);
  assert.doesNotMatch(header, /api\.example\.com\/path/);
  assert.match(header, /script-src [^;]*https:\/\/cdn\.example\.com/);
  assert.match(header, /frame-src https:\/\/frames\.example\.com/);
  assert.match(header, /base-uri 'self' https:\/\/base\.example\.com/);
  assert.match(header, new RegExp(`frame-ancestors ycode-sandbox://shell-${APP_IDENTITY}`));
});

test("shell CSP and Permissions-Policy deny everything unless the resource declared it", () => {
  const shell = buildPluginSandboxShellCsp();
  assert.match(shell, /script-src 'unsafe-inline'/);
  assert.match(shell, /frame-src ycode-sandbox:/);
  assert.match(shell, /connect-src 'none'/);

  assert.equal(buildPluginSandboxPermissionsPolicy(undefined), PLUGIN_SANDBOX_PERMISSIONS_POLICY);
  assert.match(buildPluginSandboxPermissionsPolicy(["camera"], "shell"), /camera=\*/);
  assert.match(buildPluginSandboxPermissionsPolicy(["camera"], "shell"), /microphone=\(\)/);
  assert.match(buildPluginSandboxPermissionsPolicy(["camera"], "plugin"), /camera=\(self\)/);
});

test("parsePluginSandboxUrl accepts only shell/plugin instance URLs", () => {
  const shellUrl = buildPluginSandboxShellUrl("sb-test", APP_IDENTITY);
  assert.deepEqual(parsePluginSandboxUrl(shellUrl), {
    kind: "shell",
    sandboxId: "sb-test",
    pathname: "/",
  });
  const pluginUrl = buildPluginSandboxPluginUrl("sb-test", APP_IDENTITY);
  assert.deepEqual(parsePluginSandboxUrl(pluginUrl), {
    kind: "plugin",
    sandboxId: "sb-test",
    pathname: "/index.html",
  });
  assert.equal(parsePluginSandboxUrl("https://example.com/instance/sb-test/"), null);
  assert.equal(parsePluginSandboxUrl("ycode-sandbox://other-host/instance/sb-test/"), null);
  assert.equal(parsePluginSandboxUrl("ycode-sandbox://shell-x/other/sb-test/"), null);
  assert.equal(parsePluginSandboxUrl("ycode-sandbox://shell-x:8080/instance/sb-test/"), null);
  assert.equal(parsePluginSandboxUrl("ycode-sandbox://user:pass@shell-x/instance/sb-test/"), null);
});

test("shell document is served with relay CSP and never leaks the plugin HTML", async () => {
  const { handler, handle, record } = createHandler();
  const response = await handler(new Request(handle.shellUrl));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "text/html; charset=utf-8");
  assert.equal(response.headers.get("Content-Security-Policy"), buildPluginSandboxShellCsp());
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.match(response.headers.get("Permissions-Policy") ?? "", /camera=\*/);
  const body = await response.text();
  assert.match(body, /allow-scripts allow-same-origin allow-forms/);
  assert.ok(body.includes(buildPluginSandboxPluginUrl(handle.sandboxId, APP_IDENTITY)));
  assert.doesNotMatch(body, /<html><body>plugin<\/body><\/html>/);
  assert.ok(record.cspHeader.length > 0);
});

test("plugin document carries the registered HTML, per-resource CSP and plugin permissions policy", async () => {
  const { handler, handle, record } = createHandler();
  const url = buildPluginSandboxPluginUrl(handle.sandboxId, APP_IDENTITY);
  const response = await handler(new Request(url));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Security-Policy"), record.cspHeader);
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(response.headers.get("Referrer-Policy"), "no-referrer");
  assert.match(response.headers.get("Permissions-Policy") ?? "", /camera=\(self\)/);
  assert.deepEqual(record.permissions, ["camera", "clipboardWrite"]);
  assert.equal(await response.text(), "<html><body>plugin</body></html>");
});

test("unknown sandboxes, wrong app origins, non-GET and unknown paths are rejected", async () => {
  const { handler, handle } = createHandler();
  const unknown = buildPluginSandboxPluginUrl("sb-other", APP_IDENTITY);
  assert.equal((await handler(new Request(unknown))).status, 404);

  const otherIdentity = "b".repeat(64);
  const wrongOrigin = buildPluginSandboxPluginUrl(handle.sandboxId, otherIdentity);
  assert.equal((await handler(new Request(wrongOrigin))).status, 404);

  assert.equal((await handler(new Request(handle.shellUrl, { method: "POST" }))).status, 405);

  const otherPath = `${buildPluginSandboxPluginOrigin(APP_IDENTITY)}/instance/${handle.sandboxId}/other.js`;
  assert.equal((await handler(new Request(otherPath))).status, 404);
  assert.equal((await handler(new Request("https://example.com/"))).status, 404);
});
