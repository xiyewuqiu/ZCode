import assert from "node:assert/strict";
import { chromium } from "playwright-core";
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage();
  await page.goto("http://127.0.0.1:5190/taskSwitch.html");
  const requests = () => page.evaluate(() => window.titleRequests.length);
  const settle = (index, title, taskId) =>
    page.evaluate(
      ({ index, title, taskId }) =>
        window.titleRequests[index].resolve({ meta: { title, taskId } }),
      { index, title, taskId },
    );
  const change = async (target) => {
    const count = await requests();
    await page.evaluate((target) => {
      window.titleCommits.length = 0;
      window.switchTarget(target);
    }, target);
    await page.waitForFunction(() => window.titleCommits.length > 0);
    const commits = await page.evaluate(() => window.titleCommits);
    assert.equal(
      commits[0].title,
      null,
      `the first commit must not expose previous task metadata: ${JSON.stringify(commits)}`,
    );
    if (!target.listed && target.taskId)
      await page.waitForFunction((count) => window.titleRequests.length > count, count);
  };
  await page.waitForFunction(() => window.titleRequests?.length === 1);
  await settle(0, "Task A", "a");
  await page.getByText("Task A", { exact: true }).waitFor();
  await change({ taskId: "b" });
  await settle(1, "Task B", "b");
  await page.getByText("Task B", { exact: true }).waitFor();
  await change({ taskId: "b", identity: "remote-one", remote: "r1" });
  await settle(2, "Remote B", "b");
  await page.getByText("Remote B", { exact: true }).waitFor();
  await change({ taskId: "b", identity: "remote-one", remote: "r1-reconnected" });
  await settle(3, "Reconnected B", "b");
  await page.getByText("Reconnected B", { exact: true }).waitFor();
  await change({ taskId: "b", identity: "remote-two", remote: "r2" });
  await change({ taskId: "c", identity: "remote-two", remote: "r2" });
  await settle(4, "Stale remote B", "b");
  assert.equal(await page.getByTestId("title").textContent(), "Loading");
  await settle(5, "Task C", "c");
  await page.getByText("Task C", { exact: true }).waitFor();
  const before = await requests();
  await change({ taskId: "c", listed: true });
  assert.equal(await requests(), before, "list metadata must prevent extra reads");
  await change({ taskId: "c", listed: true });
  assert.equal(await requests(), before, "new list metadata references must not trigger reads");
  await change({ taskId: null });
  await change({ taskId: "d" });
  const failing = (await requests()) - 1;
  const commitsBeforeFailure = await page.evaluate(() => window.titleCommits.length);
  await page.evaluate(
    (index) => window.titleRequests[index].reject(new Error("synthetic failure")),
    failing,
  );
  await page.waitForFunction((count) => window.titleCommits.length > count, commitsBeforeFailure);
  assert.equal(await page.evaluate(() => window.titleCommits.at(-1)?.title), null);
  assert.equal(await page.getByTestId("title").textContent(), "Loading");
  console.log(
    "PASS: first commit, task/workspace/connection isolation, stale replies, list precedence, draft",
  );
} finally {
  await browser.close();
}
