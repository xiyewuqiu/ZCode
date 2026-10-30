import assert from "node:assert/strict";
import test from "node:test";
import type { WebContents, WebPreferences } from "electron";
import { InternalChannels, PluginSandboxChannels } from "@ycode/shared";
import type { PluginSandboxRegisterInput } from "../src/main/pluginSandbox/contract.js";
import {
  buildPluginSandboxPluginOrigin,
  buildPluginSandboxShellUrl,
} from "../src/main/pluginSandbox/contract.js";
import {
  attachPluginSandboxGuest,
  configurePluginSandboxGuest,
} from "../src/main/pluginSandbox/guestPolicy.js";
import { createPluginSandboxRegistry } from "../src/main/pluginSandbox/registry.js";

const APP_IDENTITY = "d".repeat(64);

type Listener = (...args: never[]) => void;

class FakeGuest {
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly posts: Array<{ channel: string; payload: unknown; transfer: unknown[] }> = [];
  private windowOpenHandler: ((details: unknown) => unknown) | null = null;
  destroyed = false;

  on(event: string, listener: Listener) {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener);
  }

  once(event: string, listener: Listener) {
    const wrapper = ((...args: never[]) => {
      this.off(event, wrapper);
      listener(...args);
    }) as Listener;
    this.on(event, wrapper);
  }

  off(event: string, listener: Listener) {
    this.listeners.get(event)?.delete(listener);
  }

  emit(event: string, ...args: never[]) {
    for (const listener of Array.from(this.listeners.get(event) ?? [])) listener(...args);
  }

  setWindowOpenHandler(handler: (details: unknown) => unknown) {
    this.windowOpenHandler = handler;
  }

  openWindow() {
    return this.windowOpenHandler?.({});
  }

  postMessage(channel: string, payload: unknown, transfer: unknown[] = []) {
    this.posts.push({ channel, payload, transfer });
  }

  sent() {
    return this.posts;
  }

  isDestroyed() {
    return this.destroyed;
  }
}

class FakeHost {
  private readonly posts: Array<{ channel: string; payload: unknown; transfer: unknown[] }> = [];
  postMessage(channel: string, payload: unknown, transfer: unknown[] = []) {
    this.posts.push({ channel, payload, transfer });
  }
  isDestroyed() {
    return false;
  }
  sent() {
    return this.posts;
  }
}

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
    html: "<html></html>",
    permissions: ["camera"],
  };
}

function createRegistry(options: { now?: () => number; ttlMs?: number } = {}) {
  return createPluginSandboxRegistry({ createId: () => "sb-test", ...options });
}

function createChannel() {
  const closed: string[] = [];
  const port = (name: string) => ({
    close() {
      closed.push(name);
    },
  });
  return {
    closed,
    channel: { port1: port("port1"), port2: port("port2") },
  };
}

test("guest webPreferences are hardened and insecure params are stripped", () => {
  const registry = createRegistry();
  const handle = registry.register(registerInput());
  const webPreferences = {} as WebPreferences;
  const params: Record<string, string> = {
    src: handle.shellUrl,
    partition: handle.partition,
    preload: "/evil.js",
    nodeintegration: "true",
    nodeintegrationinsubframes: "true",
    disablewebsecurity: "true",
    allowpopups: "true",
    webpreferences: "nodeIntegration=yes",
  };

  const decision = configurePluginSandboxGuest({
    webPreferences,
    params,
    registry,
    ownerWebContentsId: 7,
    preloadPath: "/preload.js",
  });

  assert.deepEqual(decision, { ok: true, sandboxId: "sb-test" });
  assert.equal(webPreferences.preload, "/preload.js");
  assert.equal(webPreferences.contextIsolation, true);
  assert.equal(webPreferences.sandbox, true);
  assert.equal(webPreferences.webSecurity, true);
  assert.equal(webPreferences.nodeIntegration, false);
  assert.equal(webPreferences.nodeIntegrationInSubFrames, false);
  assert.equal(webPreferences.webviewTag, false);
  assert.equal(webPreferences.plugins, false);
  assert.equal(webPreferences.disableDialogs, true);
  assert.equal(webPreferences.allowRunningInsecureContent, false);
  for (const key of [
    "preload",
    "nodeintegration",
    "nodeintegrationinsubframes",
    "disablewebsecurity",
    "allowpopups",
    "webpreferences",
  ]) {
    assert.equal(params[key], undefined, key);
  }
});

test("guest attach validates shell URL, partition and owner", () => {
  const registry = createRegistry();
  const handle = registry.register(registerInput());
  const base = { src: handle.shellUrl, partition: handle.partition };
  const configure = (params: Record<string, string>, ownerWebContentsId = 7) =>
    configurePluginSandboxGuest({
      webPreferences: {} as WebPreferences,
      params,
      registry,
      ownerWebContentsId,
      preloadPath: "/preload.js",
    });

  assert.deepEqual(configure({ ...base, src: "https://example.com/" }), {
    ok: false,
    reason: "not-shell-url",
  });
  assert.deepEqual(
    configure({ ...base, src: buildPluginSandboxShellUrl("sb-other", APP_IDENTITY) }),
    { ok: false, reason: "unknown-sandbox" },
  );
  assert.deepEqual(configure({ ...base, partition: "persist:other" }), {
    ok: false,
    reason: "partition-mismatch",
  });
  assert.deepEqual(configure(base, 8), { ok: false, reason: "owner-mismatch" });
});

test("attached guest denies popups, pins the sandbox and wires MessagePorts on dom-ready", () => {
  const registry = createRegistry();
  const handle = registry.register(registerInput());
  const guest = new FakeGuest();
  const host = new FakeHost();
  const { channel, closed } = createChannel();

  const detach = attachPluginSandboxGuest({
    guest: guest as unknown as WebContents,
    hostWebContents: host as unknown as WebContents,
    registry,
    sandboxId: handle.sandboxId,
    createMessageChannel: () => channel,
  });

  assert.deepEqual(guest.openWindow(), { action: "deny" });

  const blocked: string[] = [];
  const navigate = (url: string) =>
    guest.emit("will-navigate", { preventDefault: () => blocked.push(url) } as never, url as never);
  navigate(handle.shellUrl);
  navigate(`${buildPluginSandboxPluginOrigin(APP_IDENTITY)}/instance/sb-test/index.html`);
  navigate("https://evil.example.com/");
  assert.deepEqual(blocked, ["https://evil.example.com/"]);

  guest.emit("dom-ready");
  const hostPorts = host.sent();
  assert.equal(hostPorts.length, 1);
  const hostPort = hostPorts[0];
  assert.ok(hostPort);
  assert.equal(hostPort.channel, InternalChannels.PluginSandboxPorts);
  assert.deepEqual(hostPort.payload, { sandboxId: "sb-test", initId: 1 });
  assert.deepEqual(hostPort.transfer, [channel.port2]);

  const guestPosts = guest.sent();
  assert.equal(guestPosts.length, 1);
  const guestPost = guestPosts[0];
  assert.ok(guestPost);
  assert.equal(guestPost.channel, PluginSandboxChannels.Init);
  assert.deepEqual(guestPost.payload, {
    sandboxId: "sb-test",
    initId: 1,
    allow: "camera",
  });
  assert.deepEqual(guestPost.transfer, [channel.port1]);
  assert.deepEqual(closed, []);

  detach();
  assert.deepEqual(closed, ["port1", "port2"]);
});

test("input events mark a one-shot user gesture for the sandbox", () => {
  const registry = createRegistry();
  const handle = registry.register(registerInput());
  const guest = new FakeGuest();
  attachPluginSandboxGuest({
    guest: guest as unknown as WebContents,
    hostWebContents: new FakeHost() as unknown as WebContents,
    registry,
    sandboxId: handle.sandboxId,
    createMessageChannel: () => createChannel().channel,
  });

  guest.emit("input-event", {} as never, { type: "mouseDown" } as never);
  assert.equal(registry.consumeUserGesture(handle.sandboxId), true);
  assert.equal(registry.consumeUserGesture(handle.sandboxId), false);

  guest.emit("input-event", {} as never, { type: "keyDown" } as never);
  assert.equal(registry.consumeUserGesture(handle.sandboxId), true);
});

test("guest reload disposes the registration so the next document cannot reuse the port", () => {
  const registry = createRegistry();
  const handle = registry.register(registerInput());
  const guest = new FakeGuest();
  attachPluginSandboxGuest({
    guest: guest as unknown as WebContents,
    hostWebContents: new FakeHost() as unknown as WebContents,
    registry,
    sandboxId: handle.sandboxId,
    createMessageChannel: () => createChannel().channel,
  });

  guest.emit("dom-ready");
  assert.ok(registry.get(handle.sandboxId));
  guest.emit("did-start-navigation", { isSameDocument: false, isMainFrame: true } as never);
  assert.equal(registry.get(handle.sandboxId), null);
});

test("live guests stay pinned until destroyed; then TTL can collect the registration", () => {
  let now = 0;
  const registry = createRegistry({ now: () => now, ttlMs: 1_000 });
  const handle = registry.register(registerInput());
  const guest = new FakeGuest();
  attachPluginSandboxGuest({
    guest: guest as unknown as WebContents,
    hostWebContents: new FakeHost() as unknown as WebContents,
    registry,
    sandboxId: handle.sandboxId,
    createMessageChannel: () => createChannel().channel,
  });

  now = 2_000;
  assert.ok(registry.get(handle.sandboxId));
  guest.destroyed = true;
  guest.emit("destroyed");
  now = 3_000;
  assert.equal(registry.get(handle.sandboxId), null);
});

test("dom-ready after the registration disappeared does not create ports", () => {
  const registry = createRegistry();
  const handle = registry.register(registerInput());
  const guest = new FakeGuest();
  const host = new FakeHost();
  attachPluginSandboxGuest({
    guest: guest as unknown as WebContents,
    hostWebContents: host as unknown as WebContents,
    registry,
    sandboxId: handle.sandboxId,
    createMessageChannel: () => createChannel().channel,
  });

  registry.dispose(handle.sandboxId);
  guest.emit("dom-ready");
  assert.deepEqual(host.sent(), []);
  assert.deepEqual(guest.sent(), []);
});

test("attaching an unknown sandbox is a no-op", () => {
  const registry = createRegistry();
  const detach = attachPluginSandboxGuest({
    guest: new FakeGuest() as unknown as WebContents,
    hostWebContents: new FakeHost() as unknown as WebContents,
    registry,
    sandboxId: "missing",
    createMessageChannel: () => createChannel().channel,
  });
  assert.equal(typeof detach, "function");
  detach();
});
