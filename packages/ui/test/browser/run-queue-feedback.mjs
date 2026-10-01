import assert from "node:assert/strict";
import { chromium } from "playwright-core";
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const base = "http://127.0.0.1:5189/queue.html";
  for (const [selector, message] of [
    ['[data-testid="v4-queue-item-delete-a"]', "未能移除待发送消息，请检查队列后重试。"],
    ['[data-testid="v4-queue-item-send-now-a"]', "未能立即发送，请检查当前任务和队列状态。"],
    ['[data-testid="v4-queue-resume"]', "未能恢复自动发送，请检查当前任务状态。"],
  ]) {
    await page.goto(base + "?failure=stale");
    await page.locator(selector).click();
    await page.getByText(message, { exact: true }).waitFor();
    assert.equal(await page.getByTestId("order").textContent(), "a,b,c / moves:0");
  }
  await page.goto(base + "?failure=stale");
  await page.locator('[data-v4-queue-drag-handle][data-queue-item-id="a"]').focus();
  await page.keyboard.press("Space");
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-v4-queue-drag-handle][data-queue-item-id="a"]')
        .getAttribute("aria-pressed") === "true",
  );
  await page.keyboard.press("ArrowDown");
  await page.getByText("移动到第 2 个位置。", { exact: true }).waitFor({ state: "attached" });
  await page.keyboard.press("Space");
  await page.getByText("未能调整发送顺序，请检查队列后重试。", { exact: true }).waitFor();
  for (const locale of ["zh-CN", "en-US"]) {
    await page.goto(base + `?failure=network&locale=${locale}`);
    await page.getByTestId("v4-queue-item-send-now-a").click();
    await page
      .getByText(
        locale === "zh-CN"
          ? "暂时无法确认操作结果，请检查队列状态后再操作。"
          : "The result could not be confirmed. Check the queue before trying again.",
        { exact: true },
      )
      .waitFor();
  }
  assert.deepEqual(errors, []);
  console.log(
    "PASS: four queue failure messages, network uncertainty, Chinese/English, no unhandled rejection",
  );
} finally {
  await browser.close();
}
