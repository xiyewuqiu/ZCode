// Agent bundle 的暂存动作：把 apps/ycode-cli/packages/cli/dist/ycode.cjs 放进
// bundled-agents/<平台>/glm，并写 meta。
//
// dev 与打包**必须**用同一份暂存实现。
// 只有打包链（prepare-agent-node-bundle.mjs）会暂存是不够的，dev 链
// （scripts/build-desktop-agent-cli.mjs）不会；而 dev 未打包时的 agent 二进制由
// desktopRuntimeEnv.ts 的 resolveBundledYCodeAgentBinaryPath() 解析，候选**只有**
// bundled-agents/，没有 cli/dist/。于是 dev 一直跑着上一次打包时留下的那份 ——
// 实测陈旧 3 天，任何 agent CLI 侧改动在 dev 里静默不生效，排查时会把「改动没生效」
// 误判成「代码没起作用」。两边共用这一份，dev 与打包不可能再各自漂移。
import { cpSync, copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export const AGENT_BUNDLE_SOURCE_RELATIVE = "apps/ycode-cli/packages/cli/dist/ycode.cjs";
const BUNDLED_SKILLS_SOURCE_RELATIVE = "apps/ycode-cli/packages/bundled-skills";
const BUNDLED_SKILL_REQUIRED_PATHS = [
  "skills/dynamic-workflows/SKILL.md",
  "skills/dynamic-workflows/patterns.md",
  "skills/dynamic-workflows/examples.md",
];

export function resolveAgentBundlePaths({ repoRoot, platformKey }) {
  const glmDir = resolve(repoRoot, "packages", "desktop", "bundled-agents", platformKey, "glm");
  return {
    cliBundlePath: resolve(repoRoot, AGENT_BUNDLE_SOURCE_RELATIVE),
    glmDir,
    stagedBundlePath: resolve(glmDir, "ycode.cjs"),
    stagedMetaPath: resolve(glmDir, ".node-bundle-meta.json"),
  };
}

/**
 * 干净重建 glm 目录再拷贝。清空是刻意的：electron-builder 整目录拷贝
 * bundled-agents/<平台>/glm → resources/glm，本地工作树里上一次构建残留的原生二进制
 * （ycode-agent / ycode-acp 等）和旧 meta 会被一并打进安装包（CI 干净检出不会有，本地会）。
 */
export function stageAgentBundle({ repoRoot, platformKey, log = console.log }) {
  const { cliBundlePath, glmDir, stagedBundlePath, stagedMetaPath } = resolveAgentBundlePaths({
    repoRoot,
    platformKey,
  });
  if (!existsSync(cliBundlePath)) {
    throw new Error(`[stage:agent-bundle] agent bundle 源产物不存在：${cliBundlePath}`);
  }
  rmSync(glmDir, { recursive: true, force: true });
  mkdirSync(glmDir, { recursive: true });
  copyFileSync(cliBundlePath, stagedBundlePath);
  stageBundledSkills({ glmDir, log, repoRoot });
  const meta = {
    runtime: "electron-node",
    entry: "ycode.cjs",
    platform: platformKey,
    source: AGENT_BUNDLE_SOURCE_RELATIVE,
  };
  writeFileSync(stagedMetaPath, `${JSON.stringify(meta, null, 2)}\n`, "utf8");
  log(`[stage:agent-bundle] staged ${stagedBundlePath}`);
  return { stagedBundlePath, stagedMetaPath };
}

/**
 * 随 CLI 内置的技能包与 ycode.cjs 同批 stage。
 *
 * 为什么必须在这里：`rmSync(glmDir)` 会清掉上一次的全部暂存，dev 链只走本文件；
 * 只让打包链（prepare-agent-node-bundle.mjs）暂存技能，dev 的 agent 就看不到
 * `dynamic-workflows`。bootstrap 的 bundled-skills.ts 只沿入口旁 `packages/bundled-skills`
 * 找，而 dev 的入口就是 glm/ycode.cjs。
 *
 * 缺技能不会 brick 工作流编辑（技能门在技能不可发现时自动失效），但模型会失去写作指南，
 * 因此缺件直接失败，不让 dev 与发布包静默分叉。
 */
function stageBundledSkills({ glmDir, log, repoRoot }) {
  const sourceRoot = resolve(repoRoot, BUNDLED_SKILLS_SOURCE_RELATIVE);
  for (const relativePath of BUNDLED_SKILL_REQUIRED_PATHS) {
    const sourcePath = resolve(sourceRoot, ...relativePath.split("/"));
    if (!existsSync(sourcePath)) {
      throw new Error(`[stage:agent-bundle] missing bundled skill asset: ${sourcePath}`);
    }
  }
  const targetRoot = resolve(glmDir, "packages", "bundled-skills");
  mkdirSync(targetRoot, { recursive: true });
  cpSync(resolve(sourceRoot, "skills"), resolve(targetRoot, "skills"), {
    recursive: true,
    filter: (sourcePath) => !sourcePath.endsWith(".DS_Store"),
  });
  log(`[stage:agent-bundle] staged bundled skills ${targetRoot}`);
}
