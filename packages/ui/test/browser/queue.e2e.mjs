import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const execute = promisify(execFile);
const binary = process.env.AGENT_BROWSER_BIN || "agent-browser";
const session = "zcode-queue-e2e";
const origin = process.env.ZCODE_UI_TEST_ORIGIN || "http://127.0.0.1:5189/queue.html";
const artifacts = resolve(".tmp/queue-e2e");
await mkdir(artifacts, { recursive: true });
async function browser(...args) {
  const { stdout } = await execute(binary, ["--session", session, ...args], { timeout: 30000 });
  return stdout.trim();
}
async function evaluate(code) {
  return JSON.parse(await browser("eval", "-b", Buffer.from(code).toString("base64")));
}
const handle = (id) => `[data-v4-queue-drag-handle][data-queue-item-id="${id}"]`;
async function open(query = "") {
  await browser("open", origin + query);
  await browser("wait", handle("a"));
}
const order = () => browser("get", "text", "[data-testid=order]");

test("queue keyboard, cancellation, locking, localization and mobile targets", async (t) => {
  try {
    await open();
    await browser("focus", handle("a"));
    await browser("press", "Space");
    await browser("press", "ArrowDown");
    await browser("press", "Space");
    assert.equal(await order(), "b,a,c / moves:1");
    assert.equal(await evaluate("document.activeElement.dataset.queueItemId"), "a");
    await browser("screenshot", resolve(artifacts, "keyboard-reordered.png"));

    await browser("press", "Enter");
    await browser("press", "ArrowUp");
    await browser("press", "Escape");
    assert.equal(await order(), "b,a,c / moves:1");
    assert.match(await browser("get", "text", "[role=status]"), /已取消排序/);

    await browser("press", "Space");
    await browser("press", "Space");
    assert.equal(await order(), "b,a,c / moves:1");
    assert.match(await browser("get", "text", "[role=status]"), /已取消排序/);

    await browser("focus", handle("c"));
    await browser("press", "Enter");
    await browser("press", "ArrowUp");
    await browser("press", "Enter");
    assert.equal(await order(), "b,c,a / moves:2");

    for (const query of ["?locked", "?readonly", "?editing"]) {
      await open(query);
      assert.equal(await evaluate(`document.querySelector('${handle("a")}').disabled`), true);
      assert.equal(await order(), "a,b,c / moves:0");
    }
    await open("?locale=en-US");
    assert.match(
      await evaluate(
        "document.getElementById(document.querySelector('[data-v4-queue-drag-handle]').getAttribute('aria-describedby')).textContent",
      ),
      /Press Space or Enter/,
    );
    await browser("set", "viewport", "390", "844");
    const sizes = await evaluate(
      "Array.from(document.querySelectorAll('li button')).map(b => ({width:b.getBoundingClientRect().width,height:b.getBoundingClientRect().height}))",
    );
    assert.ok(sizes.every((size) => size.height >= 40));
    assert.equal(await evaluate("document.documentElement.scrollWidth <= innerWidth"), true);
    await browser("screenshot", resolve(artifacts, "mobile-queue.png"));
    await evaluate("document.documentElement.classList.add('theme-zai-dark','dark')");
    await browser("set", "media", "dark", "reduced-motion");
    assert.equal(
      await evaluate(
        "getComputedStyle(document.querySelector('[data-fixture-surface]')).backgroundColor",
      ),
      "rgb(22, 22, 22)",
    );
    assert.equal(await evaluate("document.documentElement.scrollWidth <= innerWidth"), true);
    await browser("screenshot", resolve(artifacts, "mobile-dark-queue.png"));
    t.diagnostic(`Screenshots: ${artifacts}`);
  } finally {
    await browser("close");
  }
});
