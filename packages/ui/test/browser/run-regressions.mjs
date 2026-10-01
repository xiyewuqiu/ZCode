import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const scripts = await Promise.all(
  ["measureScrolling", "verifyWorkWindow", "verifySessionSwitch", "verifyInteractions"].map(
    async (name) => [name, await readFile(new URL(`./${name}.js`, import.meta.url), "utf8")],
  ),
);
const browser = await chromium.launch({
  channel: process.env.ZCODE_TEST_BROWSER_CHANNEL ?? "msedge",
  headless: true,
});
const artifacts = new URL("../../../../.tmp/desktop-iteration/", import.meta.url);
await mkdir(artifacts, { recursive: true });
try {
  for (const viewport of [
    { width: 1258, height: 622 },
    { width: 390, height: 844 },
  ]) {
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on("pageerror", (error) => {
      errors.push(error.message);
      console.error(error.message);
    });
    await page.goto(
      "http://127.0.0.1:5199/packages/ui/test/browser/longConversation.html?work=5000",
    );
    await page.locator("[data-work-window]").waitFor();
    for (const [name, source] of scripts)
      console.log(
        JSON.stringify({ viewport, scenario: name, result: await page.evaluate(source) }),
      );
    assert.deepEqual(errors, [], "Browser runtime errors");
    await page.screenshot({ path: fileURLToPath(new URL(`${viewport.width}.png`, artifacts)) });
    await page.close();
  }
} finally {
  await browser.close();
}
