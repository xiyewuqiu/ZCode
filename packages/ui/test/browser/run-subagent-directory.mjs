import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const browser = await chromium.launch({ channel: "msedge", headless: true });
const artifacts = new URL("../../../../node_modules/.cache/subagent-directory/", import.meta.url);
await mkdir(artifacts, { recursive: true });
const base = "http://127.0.0.1:5199/packages/ui/test/browser/subagentDirectory.html";
const results = [];
const frames = (page) =>
  page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
const errors = [];
try {
  for (const variant of [
    { name: "desktop-light", width: 460, height: 800, locale: "en-US", theme: "zai-light" },
    { name: "mobile-dark", width: 375, height: 760, locale: "zh-CN", theme: "zai-dark" },
    {
      name: "large-font",
      width: 390,
      height: 844,
      locale: "en-US",
      theme: "zai-light",
      large: true,
    },
  ]) {
    const page = await browser.newPage({ viewport: variant, reducedMotion: "reduce" });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${base}?locale=${variant.locale}&theme=${variant.theme}`);
    await page.waitForSelector("[data-subagent-id]");
    if (variant.large)
      await page.evaluate(() =>
        document.documentElement.style.setProperty("--ui-font-size", "20px"),
      );
    await frames(page);
    const start = await page.evaluate(() => ({ ...window.directoryMetrics }));
    await page.waitForFunction(
      (count) => window.directoryMetrics.emissions >= count + 20,
      start.emissions,
    );
    const end = await page.evaluate(() => ({ ...window.directoryMetrics }));
    assert.equal(
      end.renders,
      start.renders,
      "unrelated parent updates must not render the directory subscriber",
    );
    assert.ok((await page.locator("[data-subagent-id]").count()) < 40);
    assert.equal(
      await page
        .locator(".animate-spin")
        .first()
        .evaluate((el) => getComputedStyle(el).animationName),
      "none",
    );
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    );
    await page.screenshot({ path: fileURLToPath(new URL(`${variant.name}.png`, artifacts)) });

    await page.locator('[data-subagent-id="running-0"]').focus();
    await page.keyboard.press("End");
    await page.waitForFunction(
      () => document.activeElement?.getAttribute("data-subagent-id") === "ended-4999",
    );
    await page.keyboard.press("Enter");
    assert.equal(await page.getByTestId("opened").textContent(), "ended-4999");
    await page.keyboard.press("Home");
    await page.waitForFunction(
      () => document.activeElement?.getAttribute("data-subagent-id") === "running-0",
    );
    await page.getByTestId("subagent-directory-scroll").evaluate((el) => {
      el.scrollTop = 100000;
    });
    await frames(page);
    assert.equal(
      await page.evaluate(() => document.activeElement?.getAttribute("data-subagent-id")),
      "running-0",
    );
    const anchor = await page.evaluate(() => {
      const scroll = document.querySelector('[data-testid="subagent-directory-scroll"]');
      const top = scroll.getBoundingClientRect().top;
      const item = [...scroll.querySelectorAll("[data-subagent-id]")].find(
        (el) => el.getBoundingClientRect().top >= top && el.getBoundingClientRect().top < top + 120,
      );
      return { id: item.dataset.subagentId, top: item.getBoundingClientRect().top };
    });
    await page.evaluate(() => window.dispatchEvent(new Event("insert-ended")));
    await frames(page);
    const after = await page
      .locator(`[data-subagent-id="${anchor.id}"]`)
      .evaluate((el) => el.getBoundingClientRect().top);
    assert.ok(Math.abs(after - anchor.top) < 3, `anchor moved by ${after - anchor.top}px`);
    const scrollMetrics = await page.evaluate(async () => {
      const el = document.querySelector('[data-testid="subagent-directory-scroll"]');
      const intervals = [];
      let previous = performance.now();
      let mounted = 0;
      for (let frame = 0; frame < 120; frame++) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const now = performance.now();
        intervals.push(now - previous);
        previous = now;
        el.scrollTop += 240;
        mounted = Math.max(mounted, el.querySelectorAll("[data-subagent-id]").length);
      }
      intervals.sort((a, b) => a - b);
      return {
        mounted,
        p95: intervals[Math.floor(intervals.length * 0.95)],
        max: intervals.at(-1),
      };
    });
    assert.ok(scrollMetrics.mounted < 40, "DOM must stay bounded when scrolling 5,100 agents");
    await page.keyboard.press("Tab");
    assert.notEqual(
      await page.evaluate(() => document.activeElement?.getAttribute("data-subagent-id")),
      "running-0",
    );
    results.push({
      viewport: variant.name,
      ...scrollMetrics,
      unrelatedUpdates: end.emissions - start.emissions,
      subscriberRenders: end.renders - start.renders,
    });
    await page.close();
  }
  const page = await browser.newPage({ viewport: { width: 390, height: 800 } });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${base}?query&delay`);
  await page.waitForFunction(() => window.directoryMetrics.calls.length >= 2);
  await page.evaluate(() => window.dispatchEvent(new Event("switch-scope")));
  await page.waitForSelector('[data-subagent-id="ended-0"]');
  assert.match(await page.locator('[data-subagent-id="ended-0"]').textContent(), /scope-b/);
  await page.evaluate(() => window.dispatchEvent(new Event("finish-query")));
  await frames(page);
  assert.doesNotMatch(await page.getByTestId("subagent-directory").textContent(), /scope-a/);
  assert.equal(
    await page.evaluate(
      () =>
        window.directoryMetrics.calls.filter((call) => call.workspaceIdentity === "scope-a").length,
    ),
    2,
  );
  assert.equal(
    await page.evaluate(() =>
      window.directoryMetrics.calls
        .filter((call) => call.workspaceIdentity === "scope-b")
        .every((call) => call.remoteSessionId === "remote-scope-b"),
    ),
    true,
  );
  await page.getByRole("button", { name: "Show 20 more" }).click();
  await page.getByText("40 of 65 loaded").waitFor();
  await page.goto(`${base}?query&failure`);
  await page.getByRole("alert").waitFor();
  await page.getByRole("button", { name: "Retry" }).click();
  await page.getByText("20 of 65 loaded").waitFor();
  await page.close();
  assert.deepEqual(errors, [], "browser errors");
  await writeFile(new URL("results.json", artifacts), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ results, interactions: "passed", errors }, null, 2));
} finally {
  await browser.close();
}
