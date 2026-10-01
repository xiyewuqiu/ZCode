import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const browser = await chromium.launch({ channel: "msedge", headless: true });
const base = "http://127.0.0.1:5199/packages/ui/test/browser/taskDeleteEntry.html";
const item = (page) => page.getByTestId("task-delete-session");
const metrics = (page) => page.evaluate(() => window.deleteEntryMetrics);

try {
  const page = await browser.newPage({ viewport: { width: 460, height: 800 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base);
  await page.getByTestId("task-row").click({ button: "right" });
  await item(page).waitFor();
  assert.equal((await item(page).textContent())?.trim(), "Delete conversation…");
  // 归档入口必须保留：删除入口是新增项，不能挤掉既有任务管理动作。
  assert.equal(await page.getByRole("menuitem", { name: "Archive task", exact: true }).count(), 1);
  assert.equal(await page.getByRole("dialog").count(), 0);

  await item(page).click();
  await page.getByRole("dialog").waitFor();
  // 菜单只打开预检：确认前不能提交删除。
  await page.getByText("Storage & permanent deletion", { exact: true }).waitFor();
  await page.getByText("Conversation one", { exact: true }).waitFor();
  await page.getByText("4.0 KiB", { exact: true }).first().waitFor();
  const remove = page.getByRole("button", { name: "Permanently delete", exact: true });
  assert.equal(await remove.isEnabled(), false);
  // StrictMode 下预检 effect 会重跑一次，这里只要求至少预检过一次且没有提交删除。
  const beforePurge = await metrics(page);
  assert.equal(beforePurge.purges, 0);
  assert.ok(beforePurge.previews >= 1, `previews = ${beforePurge.previews}`);

  await page.getByRole("checkbox").check();
  await remove.click();
  await page.getByText("Conversation permanently deleted.", { exact: true }).waitFor();
  assert.equal((await metrics(page)).purges, 1);
  assert.deepEqual(errors, []);
  await page.close();

  const zh = await browser.newPage();
  await zh.goto(`${base}?locale=zh-CN`);
  await zh.getByTestId("task-row").click({ button: "right" });
  assert.equal((await item(zh).textContent())?.trim(), "删除会话…");
  await item(zh).click();
  await zh.getByRole("button", { name: "永久删除", exact: true }).waitFor();
  await zh.close();

  // 只读 workspace：入口保留但禁用，点击不得打开弹窗。
  const readOnly = await browser.newPage();
  const readOnlyErrors = [];
  readOnly.on("pageerror", (error) => readOnlyErrors.push(error.message));
  await readOnly.goto(`${base}?readonly=1`);
  await readOnly.getByTestId("task-row").click({ button: "right" });
  await item(readOnly).waitFor();
  assert.equal(
    await item(readOnly).evaluate((element) => element.hasAttribute("data-disabled")),
    true,
  );
  await item(readOnly).click({ force: true });
  await readOnly.waitForTimeout(200);
  assert.equal(await readOnly.getByRole("dialog").count(), 0);
  assert.deepEqual(await metrics(readOnly), { previews: 0, purges: 0 });
  assert.deepEqual(readOnlyErrors, []);
  await readOnly.close();

  console.log(
    "PASS: menu entry renders, opens preview dialog, requires confirmation, purges storage, zh-CN label, read-only disabled",
  );
} finally {
  await browser.close();
}
