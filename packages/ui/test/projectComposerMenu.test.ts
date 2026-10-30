/**
 * 输入框项目选择器回归：真实 ProjectComposerMenu + 真实 Radix 菜单，
 * 只替换项目目录 owner、编辑弹窗和远程入口可见性，不连接 Host / Agent。
 *
 * 运行：
 *   pnpm exec tsx --tsconfig packages/ui/tsconfig.json --test packages/ui/test/projectComposerMenu.test.ts
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { chromium, type Browser, type Page } from "playwright-core";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const fixturePath = "/packages/ui/test/browser/projectComposerMenu.html";

type RemotePreference = {
  returnTarget: {
    onVisibilityChange?(visible: boolean): void;
    finish(result: { kind: "cancelled" | "connected"; sourceServerId?: string }): void;
  };
};
declare global {
  interface Window {
    __projectComposerCalls: unknown[];
    __projectComposerPendingCalls: boolean[];
    __projectComposerRemotePreference: RemotePreference;
  }
}

let server: Awaited<ReturnType<typeof createServer>>;
let browser: Browser;
let origin: string;

before(async () => {
  server = await createServer({
    root,
    configFile: false,
    plugins: [
      {
        name: "project-composer-fixture",
        enforce: "pre",
        load(id) {
          if (id.endsWith("/project-sidebar/ProjectDirectoryProvider.tsx")) {
            return [
              "export const useProjectDirectory = () => globalThis.__projectComposerDirectory;",
              "export const useOptionalProjectDirectory = useProjectDirectory;",
              "export function ProjectDirectoryProvider({ children }) { return children; }",
            ].join("\n");
          }
          if (id.endsWith("/project-sidebar/ProjectEditor.tsx")) {
            return [
              'import { createElement } from "react";',
              "export function ProjectEditor({ project }) {",
              '  return createElement("input", {',
              '    "aria-label": "Editing project",',
              '    value: project.hostId + "/" + project.id,',
              "    readOnly: true,",
              "  });",
              "}",
            ].join("\n");
          }
          if (id.endsWith("/hooks/useRemoteConnectionEntryVisibility.ts")) {
            return "export function useRemoteConnectionEntryVisibility() { return true; }";
          }
          // 远程身份详情的连接区读取设备管理服务，且开发态预打包会拆出多份 Radix
          // HoverCard scope；项目 chip 回归只替换该展示边界，菜单与选择逻辑仍用生产组件。
          if (id.endsWith("/project-sidebar/RemoteIdentityHoverCard.tsx")) {
            return "export function RemoteIdentityHoverCard({ children }) { return children; }";
          }
          if (id.endsWith("/project-sidebar/RemoteConnectionProgressSection.tsx")) {
            return "export function RemoteConnectionProgressSection() { return null; }";
          }
          return undefined;
        },
      },
      react(),
      tailwindcss(),
    ],
    resolve: { alias: { "@": `${root}packages/ui/src` } },
    server: { host: "127.0.0.1", port: 0, hmr: false },
  });
  await server.listen();
  origin = server.resolvedUrls!.local[0]!;
  browser = await chromium.launch(
    process.env.CHROME_EXECUTABLE_PATH
      ? { executablePath: process.env.CHROME_EXECUTABLE_PATH, headless: true }
      : { channel: "chrome", headless: true },
  );
});

after(async () => {
  await browser?.close();
  await server?.close();
});

async function open(page: Page, query = "") {
  await page.goto(`${origin}${fixturePath}${query ? `?${query}` : ""}`);
  await page.getByTestId("composer-workspace-trigger").waitFor();
}

async function openMenu(page: Page) {
  await page.getByTestId("composer-workspace-trigger").click();
  await page.locator('[role="menuitemcheckbox"][data-project-id]').first().waitFor();
}

const entries = (page: Page) => page.locator('[role="menuitemcheckbox"][data-project-id]');

async function withPage(run: (page: Page) => Promise<void>) {
  const page = await browser.newPage({ viewport: { width: 1100, height: 820 } });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await run(page);
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
}

test("选择项目走 onCreateTask，并保留搜索和项目身份", { timeout: 60_000 }, async () => {
  await withPage(async (page) => {
    await open(page);
    const trigger = page.getByTestId("composer-workspace-trigger");
    assert.match(await trigger.textContent(), /Project 1/);
    await openMenu(page);
    assert.equal(await entries(page).count(), 5);
    await page.locator('[data-slot="command-input"]').fill("other");
    assert.deepEqual(
      await entries(page).evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute("data-project-name")),
      ),
      ["Project 0"],
    );
    await page.locator('[role="menuitemcheckbox"][data-project-id="0"]').click();
    assert.deepEqual(await page.evaluate(() => window.__projectComposerCalls), [
      { projectId: "0" },
    ]);
  });
});

test("离线项目保留但禁用，零 root 项目仍可选择", { timeout: 60_000 }, async () => {
  await withPage(async (page) => {
    await open(page);
    await openMenu(page);
    const offline = page.locator('[role="menuitemcheckbox"][data-project-name="Offline Project"]');
    assert.equal(await offline.getAttribute("aria-checked"), "false");
    assert.notEqual(await offline.getAttribute("data-disabled"), null);
    await offline.click({ force: true }).catch(() => {});
    assert.deepEqual(await page.evaluate(() => window.__projectComposerCalls), []);
    await page.locator('[role="menuitemcheckbox"][data-project-id="zero"]').click();
    assert.deepEqual(await page.evaluate(() => window.__projectComposerCalls), [
      { projectId: "zero" },
    ]);
  });
});

test("编辑项目入口使用当前 Host 身份，并在不可编辑时隐藏", { timeout: 60_000 }, async () => {
  await withPage(async (page) => {
    await open(page);
    await page.getByTestId("composer-edit-project").click();
    assert.equal(await page.getByLabel("Editing project").inputValue(), "local/1");
  });
  await withPage(async (page) => {
    await open(page, "identity=remote");
    assert.match(
      await page.getByTestId("composer-workspace-trigger").textContent(),
      /Remote Project/,
    );
    await page.getByTestId("composer-edit-project").click();
    assert.equal(await page.getByLabel("Editing project").inputValue(), "remote:server:host/1");
  });
  await withPage(async (page) => {
    await open(page, "edit=0");
    assert.equal(await page.getByTestId("composer-edit-project").count(), 0);
  });
  await withPage(async (page) => {
    // 当前项目离线时不能打开编辑器；项目身份仍由 roots 投影。
    await open(page, "path=/offline");
    assert.match(
      await page.getByTestId("composer-workspace-trigger").textContent(),
      /Offline Project/,
    );
    assert.equal(await page.getByTestId("composer-edit-project").count(), 0);
  });
});

test("远程连接意图持有提交门禁，后台/取消只解除当前草稿", { timeout: 60_000 }, async () => {
  await withPage(async (page) => {
    await open(page);
    await openMenu(page);
    await page.getByTestId("composer-remote-connection").click();
    await page.waitForFunction(() => window.__projectComposerPendingCalls.at(-1) === true);
    assert.equal(
      await page.evaluate(() => {
        const target = window.__projectComposerRemotePreference.returnTarget;
        target.onVisibilityChange(false);
        return window.__projectComposerPendingCalls.at(-1);
      }),
      false,
    );
    assert.equal(
      await page.evaluate(() => {
        const target = window.__projectComposerRemotePreference.returnTarget;
        target.onVisibilityChange(true);
        return window.__projectComposerPendingCalls.at(-1);
      }),
      true,
    );
    assert.equal(
      await page.evaluate(() => {
        const target = window.__projectComposerRemotePreference.returnTarget;
        target.finish({ kind: "cancelled" });
        return window.__projectComposerPendingCalls.at(-1);
      }),
      false,
    );
  });
});

test("同 ID 不同 Host 的项目互不串选，选择携带 Host 身份", { timeout: 60_000 }, async () => {
  await withPage(async (page) => {
    await open(page, "identity=remote");
    await openMenu(page);
    const remote = page.locator(
      '[role="menuitemcheckbox"][data-project-host="remote:server:host"]',
    );
    const local = page.locator(
      '[role="menuitemcheckbox"][data-project-host="local"][data-project-id="1"]',
    );
    assert.equal(await remote.getAttribute("aria-checked"), "true");
    assert.equal(await local.getAttribute("aria-checked"), "false");
    await remote.click();
    assert.deepEqual(await page.evaluate(() => window.__projectComposerCalls), [
      { projectId: "1", hostId: "remote:server:host" },
    ]);
  });
});

test("远控紧凑模式选择本地项目时也显式携带 Host", { timeout: 60_000 }, async () => {
  await withPage(async (page) => {
    await open(page, "mobile=1");
    await openMenu(page);
    await page.locator('[role="menuitemcheckbox"][data-project-id="0"]').click();
    assert.deepEqual(await page.evaluate(() => window.__projectComposerCalls), [
      { projectId: "0", hostId: "local" },
    ]);
  });
});
