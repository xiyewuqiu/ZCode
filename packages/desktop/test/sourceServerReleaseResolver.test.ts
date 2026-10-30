import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { YCODE_VERSION } from "@ycode/shared";
import { resolveSourceServerReleaseAsset } from "../src/host/sourceServerReleaseResolver.js";

test("development content-addressed release resolves the staged local archive", async () => {
  const root = await mkdtemp(join(tmpdir(), "ycode-release-"));
  const releaseDir = join(root, "releases", YCODE_VERSION);
  const fileName = "zcode-server-linux-x64.tar.gz";
  const payload = Buffer.from("fake archive");
  try {
    await mkdir(releaseDir, { recursive: true });
    await writeFile(join(releaseDir, fileName), payload);
    const descriptor = {
      schemaVersion: 1,
      version: YCODE_VERSION,
      archives: [
        {
          target: "linux-x64",
          version: YCODE_VERSION,
          fileName,
          sha256: createHash("sha256").update(payload).digest("hex"),
          sizeBytes: payload.byteLength,
          urls: [fileName],
        },
      ],
    };
    await writeFile(
      join(releaseDir, "source-server-release.json"),
      JSON.stringify(descriptor),
      "utf8",
    );

    const release = await resolveSourceServerReleaseAsset(
      { platform: "linux", arch: "x64", installed: false },
      { mockCdnDir: root, sourceServerArtifactPolicy: "development-content-addressed" },
      {
        kind: "ssh",
        host: "example.com",
        username: "dev",
        assetInstallMode: "local-download-upload",
      },
    );
    assert.equal(release.version, YCODE_VERSION);
    assert.equal(release.target, "linux-x64");
    assert.equal(release.localArchivePath, join(releaseDir, fileName));
    assert.equal(release.sizeBytes, payload.byteLength);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
