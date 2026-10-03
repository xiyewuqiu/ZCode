import assert from "node:assert/strict";
import { chromium } from "playwright-core";

// 需要 `vite --config packages/ui/test/browser/vite.config.mjs` 已在 5199 端口运行。
const browser = await chromium.launch({
  channel: process.env.ZCODE_TEST_BROWSER_CHANNEL ?? "msedge",
  headless: true,
});
try {
  const page = await browser.newPage({ viewport: { width: 1024, height: 700 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("http://127.0.0.1:5199/packages/ui/test/browser/layerActivity.html");
  await page.locator('[data-testid="chat-value"]').waitFor();

  const counters = () => page.evaluate(() => ({ ...globalThis.__layerCounters }));
  const readValue = (testId) =>
    page.evaluate((id) => {
      const element = document.querySelector(`[data-testid="${id}"]`);
      return { value: Number(element.dataset.value), renders: Number(element.dataset.renders) };
    }, testId);

  const chatInitial = await readValue("chat-value");
  const before = await counters();
  assert.equal(before.chatMounts, 1, "聊天层应挂载一次");
  assert.equal(before.otherMounts, 1, "另一层也应挂载（常驻）");

  // 活动层：每次推送都必须到达。
  for (let index = 0; index < 5; index++) {
    await page.locator('[data-testid="push-update"]').click();
  }
  const chatActive = await readValue("chat-value");
  assert.equal(chatActive.value, 5, "活动层必须读到最新状态");

  // 切走：层保持挂载，但不再接收通知。
  await page.locator('[data-testid="switch-view"]').click();
  const chatHidden = await readValue("chat-value");
  const rendersAfterHide = (await counters()).chatRenders;
  for (let index = 0; index < 30; index++) {
    await page.locator('[data-testid="push-update"]').click();
  }
  const chatWhileHidden = await readValue("chat-value");
  const countersWhileHidden = await counters();
  assert.equal(countersWhileHidden.chatMounts, 1, "隐藏层不能卸载（保持滚动位置与订阅）");
  assert.equal(countersWhileHidden.chatRenders, rendersAfterHide, "隐藏层不接收 React 通知");
  assert.equal(chatHidden.renders, chatWhileHidden.renders);
  assert.equal(chatWhileHidden.value, 5, "隐藏层 DOM 保持旧的（不可见）状态");
  assert.equal((await readValue("other-value")).value, 35, "另一活动层持续接收通知");

  const hiddenLayerState = await page.evaluate(() => {
    const layer = document.querySelector('[data-testid="layer-chat"]');
    return {
      active: layer.dataset.layerActive,
      inert: layer.hasAttribute("inert"),
      ariaHidden: layer.getAttribute("aria-hidden"),
      visibility: getComputedStyle(layer).visibility,
    };
  });
  assert.equal(hiddenLayerState.active, "false");
  assert.equal(hiddenLayerState.inert, true, "隐藏层必须 inert");
  assert.equal(hiddenLayerState.ariaHidden, "true");
  assert.equal(hiddenLayerState.visibility, "hidden", "隐藏层保留布局但不绘制");

  // 切回：一次渲染读到最新状态，仍不重挂。
  await page.locator('[data-testid="switch-view"]').click();
  const restored = await readValue("chat-value");
  const countersRestored = await counters();
  assert.equal(countersRestored.chatMounts, 1, "切回不能重新挂载");
  assert.equal(restored.value, 35, "切回必须一次读到最新状态");
  // 激活提交 + 门控补一次通知：总渲染次数与隐藏期间累积的 30 次更新无关。
  assert.ok(
    countersRestored.chatRenders <= rendersAfterHide + 2,
    `激活渲染次数必须与隐藏期间的更新数无关（实际 ${countersRestored.chatRenders}）`,
  );
  const visibleLayerState = await page.evaluate(() => {
    const layer = document.querySelector('[data-testid="layer-chat"]');
    return {
      active: layer.dataset.layerActive,
      inert: layer.hasAttribute("inert"),
      visibility: getComputedStyle(layer).visibility,
    };
  });
  assert.equal(visibleLayerState.active, "true");
  assert.equal(visibleLayerState.inert, false);
  assert.equal(visibleLayerState.visibility, "visible");
  assert.equal(chatActive.renders > 0, true);

  // 高度不变量：隐藏层脱离流用 absolute inset-0，容器高度必须由宿主决定，
  // 不能塌陷，也不能让隐藏层内滚动容器高度归零。
  const geometry = await page.evaluate(() => {
    const host = document.querySelector('[data-testid="layer-host"]');
    const chat = document.querySelector('[data-testid="layer-chat"]');
    const other = document.querySelector('[data-testid="layer-other"]');
    return {
      host: Math.round(host.getBoundingClientRect().height),
      chat: Math.round(chat.getBoundingClientRect().height),
      other: Math.round(other.getBoundingClientRect().height),
    };
  });
  assert.equal(geometry.host, 200, "宿主高度必须由外部决定");
  assert.equal(geometry.chat, geometry.host, "活动层必须撑满宿主");
  assert.equal(geometry.other, geometry.host, "隐藏层与活动层同盒，测高不归零");

  await page.locator('[data-testid="switch-view"]').click();
  const geometrySwitched = await page.evaluate(() => {
    const host = document.querySelector('[data-testid="layer-host"]');
    const chat = document.querySelector('[data-testid="layer-chat"]');
    return {
      host: Math.round(host.getBoundingClientRect().height),
      chat: Math.round(chat.getBoundingClientRect().height),
    };
  });
  assert.equal(geometrySwitched.host, 200, "切换后宿主高度不变");
  assert.equal(geometrySwitched.chat, geometrySwitched.host, "切走后 chat 仍保持同盒高度");

  // 中文 IME：组合态中切层，已确认的输入不能丢。
  const cdp = await page.context().newCDPSession(page);
  await page.locator('[data-testid="switch-view"]').click();
  const composer = page.locator('[data-testid="chat-composer"]');
  await composer.click();
  const composition = await page.evaluate(() => {
    const events = [];
    const target = document.querySelector('[data-testid="chat-composer"]');
    for (const type of ["compositionstart", "compositionupdate", "compositionend", "blur"]) {
      target.addEventListener(type, () => events.push(type));
    }
    globalThis.__imeEvents = events;
    return true;
  });
  assert.equal(composition, true);
  await cdp.send("Input.imeSetComposition", {
    text: "zhong",
    selectionStart: 5,
    selectionEnd: 5,
  });
  const duringComposition = await page.evaluate(() => ({
    events: [...globalThis.__imeEvents],
    value: document.querySelector('[data-testid="chat-composer"]').value,
  }));
  assert.ok(duringComposition.events.includes("compositionstart"), "CDP 组合态必须真正开始");
  await page.locator('[data-testid="switch-view"]').click();
  const afterSwitch = await page.evaluate(() => ({
    events: [...globalThis.__imeEvents],
    value: document.querySelector('[data-testid="chat-composer"]').value,
    activeInsideChat: Boolean(
      document.querySelector('[data-testid="layer-chat"]').contains(document.activeElement),
    ),
  }));
  assert.ok(
    afterSwitch.events.includes("compositionend"),
    `层切换必须结束组合态（实际事件 ${afterSwitch.events.join(",")}）`,
  );
  assert.ok(
    afterSwitch.value.length > 0,
    `层切换不能丢掉已输入的组合文本（实际 "${afterSwitch.value}"）`,
  );
  assert.equal(afterSwitch.activeInsideChat, false, "切走后 chat 内不能残留焦点");

  assert.deepEqual(errors, [], "浏览器运行时错误");
  console.log(
    JSON.stringify({
      chatInitial,
      chatActive,
      hiddenRenders: rendersAfterHide,
      restoredRenders: countersRestored.chatRenders,
      restoredValue: restored.value,
      otherValue: 35,
      geometry,
      composition: duringComposition,
      afterSwitch,
    }),
  );
} finally {
  await browser.close();
}
