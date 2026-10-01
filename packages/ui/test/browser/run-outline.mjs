import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const browser = await chromium.launch({
  channel: process.env.ZCODE_TEST_BROWSER_CHANNEL ?? "msedge",
  headless: true,
});
const artifacts = new URL("../../../../.tmp/conversation-outline/", import.meta.url);
await mkdir(artifacts, { recursive: true });
const base = "http://127.0.0.1:5199/packages/ui/test/browser/";
const waitSelected = (page, rowId) =>
  page.waitForFunction(
    (id) =>
      document
        .querySelector('[role="option"][aria-selected="true"]')
        ?.getAttribute("data-outline-row") === String(id),
    rowId,
  );
const finishLoad = (page, status) =>
  page.evaluate(
    (detail) => window.dispatchEvent(new CustomEvent("outline-load-finish", { detail })),
    status,
  );
try {
  for (const viewport of [
    { width: 1258, height: 700 },
    { width: 390, height: 844 },
    { width: 260, height: 700 },
  ]) {
    const page = await browser.newPage({ viewport, reducedMotion: "reduce" });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${base}conversationOutline.html`);
    const trigger = page.getByTestId("conversation-outline-open");
    await trigger.click();
    const search = page.getByRole("combobox");
    await search.waitFor();
    await waitSelected(page, 1000);
    assert.ok(
      (await page.getByRole("option").count()) < 25,
      "2000-item outline must remain virtualized",
    );
    await search.fill("深层关键词");
    await waitSelected(page, 1700);
    assert.equal(await page.getByRole("option").count(), 1);
    await search.fill("#1999");
    await waitSelected(page, 1998);
    await search.press("Enter");
    await page.getByTestId("conversation-outline").waitFor({ state: "detached" });
    assert.equal(await page.getByTestId("jump").textContent(), "1998");
    await page.waitForFunction(
      () =>
        document.activeElement ===
        document.querySelector('[data-testid="conversation-outline-open"]'),
    );
    await trigger.click();
    await search.press("Control+End");
    await waitSelected(page, 1999);
    await search.press("ArrowUp");
    await waitSelected(page, 1998);
    await search.press("Control+Home");
    await waitSelected(page, 0);
    await search.press("PageDown");
    await page.waitForFunction(
      () =>
        Number(document.querySelector('[aria-selected="true"]')?.getAttribute("data-outline-row")) >
        0,
    );
    await search.fill("no-such-question");
    await page.getByText("No matching questions", { exact: true }).waitFor();
    await search.press("Enter");
    assert.equal(await page.getByTestId("conversation-outline").count(), 1);
    await search.fill("");
    await waitSelected(page, 1000);
    await search.evaluate((element) =>
      element.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true }),
      ),
    );
    assert.equal(
      await page.getByTestId("conversation-outline").count(),
      1,
      "IME composition must not jump",
    );
    const loadButton = page.getByRole("button", { name: "Load complete outline", exact: true });
    await loadButton.click();
    await page.getByRole("button", { name: "Loading earlier messages...", exact: true }).waitFor();
    assert.equal(await page.getByTestId("load-count").textContent(), "1");
    await finishLoad(page, "retryable-failure");
    await page.getByRole("alert").waitFor();
    await loadButton.click();
    assert.equal(await page.getByTestId("load-count").textContent(), "2");
    await finishLoad(page, "hydrated");
    await page
      .getByText("Earlier history is not fully loaded", { exact: true })
      .waitFor({ state: "detached" });
    await search.focus();
    await search.press("Escape");
    await page.getByTestId("conversation-outline").waitFor({ state: "detached" });
    await page.waitForFunction(
      () =>
        document.activeElement ===
        document.querySelector('[data-testid="conversation-outline-open"]'),
    );
    await trigger.click();
    assert.equal(
      await page
        .getByTestId("conversation-outline")
        .evaluate((element) => getComputedStyle(element).animationName),
      "none",
      "Reduced motion must disable modal animation",
    );
    await page.screenshot({
      path: fileURLToPath(new URL(`${viewport.width}.png`, artifacts)),
      animations: "disabled",
    });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    );
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify({
        viewport,
        virtualized: true,
        search: true,
        keyboard: true,
        IME: true,
        loadRetry: true,
        focusRestore: true,
      }),
    );
    await page.close();
  }
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    reducedMotion: "reduce",
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${base}conversationOutline.html`);
  await page.getByTestId("conversation-outline-open").click();
  await page.getByRole("button", { name: "Load complete outline", exact: true }).click();
  await page.evaluate(() => window.dispatchEvent(new Event("outline-switch-scope")));
  await page.getByTestId("conversation-outline").waitFor({ state: "detached" });
  await page.getByTestId("conversation-outline-open").click();
  await finishLoad(page, "retryable-failure");
  assert.equal(
    await page.getByRole("alert").count(),
    0,
    "Stale request must not change a new scope",
  );
  await page.goto(`${base}conversationOutline.html?locale=zh-CN`);
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  await page.getByTestId("conversation-outline-open").click();
  await page.getByRole("combobox", { name: "搜索问题或回答摘要" }).fill("深层关键词");
  await waitSelected(page, 1700);
  await page.screenshot({
    path: fileURLToPath(new URL("chinese-dark.png", artifacts)),
    animations: "disabled",
  });
  for (const width of [390, 1258]) {
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ reducedMotion: width === 390 ? "reduce" : "no-preference" });
    await page.goto(`${base}longConversation.html?work=5000&outline=1`);
    await page.getByTestId("stream").click();
    await page.getByTestId("conversation-outline-open").click();
    await page.getByRole("combobox").fill("unique-query-49");
    await waitSelected(page, 296);
    await page.waitForFunction(() =>
      document
        .querySelector('[data-v4-timeline-scroll="true"]')
        ?.textContent.includes("token token token"),
    );
    assert.equal(await page.getByRole("combobox").inputValue(), "unique-query-49");
    await waitSelected(page, 296);
    await page.getByRole("option").filter({ hasText: "Question 49" }).click();
    await page.getByTestId("conversation-outline").waitFor({ state: "detached" });
    await page.waitForFunction(() => {
      const row = document.querySelector('section[data-turn-id="turn-49"] [data-row-id="296"]');
      const scroller = document.querySelector('[data-v4-timeline-scroll="true"]');
      if (!row || !scroller) return false;
      const target = row.getBoundingClientRect();
      const viewport = scroller.getBoundingClientRect();
      return target.bottom > viewport.top && target.top < viewport.bottom;
    });
    await page.getByTestId("stream").click();
    await page.getByTestId("conversation-outline-open").click();
    await page.getByRole("button", { name: "Latest question", exact: true }).click();
    await page.locator('section[data-turn-id="turn-99"]').waitFor();
    await page.getByTestId("conversation-outline-open").click();
    await page.getByRole("combobox").fill("unique-query-49");
    await page.evaluate(() => window.dispatchEvent(new Event("outline-switch-workspace")));
    await page.getByTestId("conversation-outline").waitFor({ state: "detached" });
    await page.getByTestId("conversation-outline-open").click();
    assert.equal(
      await page.getByRole("combobox").inputValue(),
      "",
      "Same-path workspace switch must reset the outline scope",
    );
  }
  await page.goto(`${base}longConversation.html?work=40`);
  await page.locator('[data-v4-timeline-scroll="true"]').waitFor();
  assert.equal(
    await page.getByTestId("conversation-outline-open").count(),
    0,
    "hideTurnNavigator must also hide the outline entry",
  );
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      scopeIsolation: true,
      actualTimelineJump: true,
      latestQuestion: true,
      streamingSelection: true,
      chineseDark: true,
      hiddenEntry: true,
    }),
  );
  await page.close();
} finally {
  await browser.close();
}
