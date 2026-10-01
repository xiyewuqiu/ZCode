import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const compiler = createRequire(import.meta.url).resolve("typescript/bin/tsc");
for (const target of ["main", "preload", "renderer"]) {
  const code = await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        compiler,
        "-p",
        `packages/desktop/tsconfig.${target}.json`,
        "--noEmit",
        "--composite",
        "false",
        "--incremental",
        "false",
      ],
      { cwd: root, stdio: "inherit", windowsHide: true },
    );
    child.once("error", reject);
    child.once("exit", (status) => resolve(status ?? 1));
  });
  if (code !== 0) {
    process.exitCode = code;
    break;
  }
}
