import assert from "node:assert/strict";
import test from "node:test";
import type { ConnectionProfile } from "@ycode/shared";
import type { IRemoteProjectService, RemoteProjectHost } from "#src/remote-projects/contract.js";
import {
  createRemoteProjectConnectionAdmission,
  remoteProjectHostIdForProfile,
} from "#src/remote-projects/index.js";

const profile: ConnectionProfile = {
  profileId: "profile",
  transport: "docker",
  target: { kind: "docker", container: "test" },
  createdAt: 1,
};

function fixture() {
  const host: RemoteProjectHost = {
    id: "remote:docker:test",
    membershipId: "original",
    kind: "docker",
    target: profile.target,
    position: 0,
  };
  let directoryHosts = [host];
  const saveCalls: Array<{ id: string; target: unknown }> = [];
  const bindCalls: Array<{
    id: string;
    membershipId: string;
    resolvedId: string;
    createDistinctHost?: boolean;
  }> = [];
  let bindResult: RemoteProjectHost | null = host;
  const service = {
    async readDirectory() {
      return { hosts: directoryHosts, entries: [] };
    },
    async saveHost(input: { id: string; target: unknown }) {
      saveCalls.push(input);
      return host;
    },
    async bindHost(input: {
      id: string;
      membershipId: string;
      resolvedId: string;
      createDistinctHost?: boolean;
    }) {
      bindCalls.push(input);
      return bindResult;
    },
  } as unknown as IRemoteProjectService;
  return {
    service,
    host,
    saveCalls,
    bindCalls,
    admit: createRemoteProjectConnectionAdmission(service),
    setDirectoryHosts(next: RemoteProjectHost[]) {
      directoryHosts = next;
    },
    setBindResult(next: RemoteProjectHost | null) {
      bindResult = next;
    },
  };
}

test("resolves both canonical addresses and trusted Source identities using shared identity helpers", () => {
  assert.equal(remoteProjectHostIdForProfile(profile), "remote:docker:test");
  assert.equal(
    remoteProjectHostIdForProfile({ ...profile, sourceServerId: "stable" }),
    "remote:server:stable",
  );
});

test("captures membership before the handshake, then commits with that exact generation", async () => {
  const { host, admit, saveCalls, bindCalls, setBindResult } = fixture();
  const commit = await admit({ profile, intent: "add", confirmIdentityChange: false });
  assert.deepEqual(saveCalls, [
    { id: remoteProjectHostIdForProfile(profile), target: profile.target },
  ]);
  await commit("stable");
  assert.deepEqual(bindCalls, [
    {
      id: host.id,
      membershipId: "original",
      resolvedId: "remote:server:stable",
      createDistinctHost: false,
    },
  ]);
  setBindResult(null);
  await assert.rejects(commit("stable"), /remote-project\.host-removed/);
  assert.equal(saveCalls.length, 1);
});

test("never adds a removed connection on startup or automatic retry", async () => {
  const { admit, saveCalls, bindCalls, setDirectoryHosts } = fixture();
  setDirectoryHosts([]);
  await assert.rejects(
    admit({ profile, intent: "retain", confirmIdentityChange: false }),
    /remote-project\.host-removed/,
  );
  assert.equal(saveCalls.length, 0);
  assert.equal(bindCalls.length, 0);
});
