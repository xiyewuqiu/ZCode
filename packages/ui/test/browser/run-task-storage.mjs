import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const browser = await chromium.launch({ channel: "msedge", headless: true });
const base = "http://127.0.0.1:5199/packages/ui/test/browser/taskStorage.html";
const artifacts = new URL(
  "../../../../node_modules/.cache/session-purge-browser/",
  import.meta.url,
);
await mkdir(artifacts, { recursive: true });
try {
  for (const width of [1100, 390, 260]) {
    const page = await browser.newPage({
      viewport: { width, height: 820 },
      reducedMotion: "reduce",
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(base);
    await page.getByText("Open storage", { exact: true }).click();
    const deleteConfirm = page.getByTestId("task-storage-delete-confirm");
    await deleteConfirm.waitFor();
    const remove = page.getByRole("button", { name: "Permanently delete", exact: true });
    assert.equal(await remove.isEnabled(), false);
    assert.equal(await page.getByTestId("calls").textContent(), "0");
    assert.equal(await page.getByTestId("optimize-calls").textContent(), "0");
    await deleteConfirm.check();
    await page.getByRole("button", { name: "Check again", exact: true }).click();
    await deleteConfirm.waitFor();
    assert.equal(await deleteConfirm.isChecked(), false);
    await deleteConfirm.check();
    await page.screenshot({
      path: fileURLToPath(new URL(`${width}.png`, artifacts)),
      animations: "disabled",
    });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    );
    await remove.click();
    await page.getByText("Conversation permanently deleted.", { exact: true }).waitFor();
    assert.equal(await page.getByTestId("calls").textContent(), "1");
    assert.deepEqual(errors, []);
    await page.close();
  }
  for (const scenario of ["blocked", "pending", "error", "delay"]) {
    const page = await browser.newPage();
    await page.goto(`${base}?${scenario}=1`);
    await page.getByText("Open storage", { exact: true }).click();
    if (scenario === "delay") {
      await page.getByRole("button", { name: "Close", exact: true }).first().click();
      await page.evaluate(() => window.dispatchEvent(new Event("finish-preview")));
      assert.equal(await page.getByRole("dialog").count(), 0);
    } else if (scenario === "blocked") {
      await page.getByRole("alert").waitFor();
      assert.equal(await page.getByTestId("task-storage-delete-confirm").count(), 0);
      assert.equal(
        await page.getByRole("button", { name: "Permanently delete", exact: true }).isEnabled(),
        false,
      );
    } else {
      await page.getByTestId("task-storage-delete-confirm").check();
      await page.getByRole("button", { name: "Permanently delete", exact: true }).click();
      if (scenario === "error") {
        await page.getByRole("alert").waitFor();
        await page.getByRole("button", { name: "Check again", exact: true }).click();
        await page.getByTestId("task-storage-delete-confirm").check();
      }
      await page
        .getByRole("button", {
          name: scenario === "error" ? "Permanently delete" : "Retry cleanup",
          exact: true,
        })
        .click();
      await page.getByText("Conversation permanently deleted.", { exact: true }).waitFor();
      assert.equal(await page.getByTestId("calls").textContent(), "2");
    }
    await page.close();
  }
  const page = await browser.newPage();
  await page.goto(`${base}?locale=zh-CN`);
  await page.getByText("Open storage", { exact: true }).click();
  await page.getByTestId("task-storage-delete-confirm").check();
  await page.getByTestId("switch").evaluate((button) => button.click());
  await page.getByText("Conversation 1", { exact: true }).waitFor();
  assert.equal(await page.getByTestId("task-storage-delete-confirm").isChecked(), false);
  await page.getByRole("button", { name: "永久删除", exact: true }).waitFor();
  await page.close();

  // 显式数据库整理：打开弹窗不自动整理；确认后才调用一次，并展示 before/after。
  const maintenance = await browser.newPage();
  await maintenance.goto(base);
  await maintenance.getByText("Open storage", { exact: true }).click();
  const optimize = maintenance.getByRole("button", { name: "Optimize database", exact: true });
  await optimize.waitFor();
  assert.equal(await optimize.isEnabled(), false);
  assert.equal(await maintenance.getByTestId("optimize-calls").textContent(), "0");
  await maintenance.getByTestId("task-storage-optimize-confirm").check();
  await optimize.click();
  await maintenance
    .getByText("Database compacted and WAL checkpointed. Reclaimed 8.0 KiB.", { exact: true })
    .waitFor();
  assert.equal(await maintenance.getByTestId("optimize-calls").textContent(), "1");
  assert.equal(
    await maintenance.getByText("Database: 16.0 KiB → 8.0 KiB", { exact: true }).isVisible(),
    true,
  );
  await maintenance.close();
  console.log(
    "PASS: desktop/mobile/narrow, explicit confirmation, preview reset, source switch, blocked, retry, network error, stale unmount and explicit database maintenance",
  );
} finally {
  await browser.close();
}
