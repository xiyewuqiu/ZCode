(async () => {
  const expect = (value, message) => {
    if (!value) throw new Error(message);
  };
  const until = async (predicate, message) => {
    const deadline = performance.now() + 15000;
    while (!predicate()) {
      expect(performance.now() < deadline, message);
      await new Promise(requestAnimationFrame);
    }
  };
  const scroller = document.querySelector('[data-v4-timeline-scroll="true"]');
  const find = document.querySelector('[data-testid="find"]');
  const setQuery = (value) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(find, value);
    find.dispatchEvent(new Event("input", { bubbles: true }));
  };
  setQuery("");
  await until(
    () => document.querySelector('[data-testid="matches"]').textContent === "0",
    "Find did not clear",
  );
  await until(() => document.querySelector("[data-work-window]"), "Work window missing");
  const list = document.querySelector("[data-work-window]");
  const count = Number(list.dataset.workCount);
  expect(count >= 1000, "Fixture must contain at least 1,000 work items");
  expect(list.querySelectorAll("[data-work-index]").length < 80, "Work DOM is not bounded");
  scroller.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, bubbles: true }));
  scroller.scrollTop +=
    list.getBoundingClientRect().top - scroller.getBoundingClientRect().top + list.clientHeight / 2;
  await until(
    () => Number(list.querySelector("[data-work-index]")?.dataset.workIndex) > 100,
    "Middle rows failed to mount",
  );
  const visibleRow = () =>
    [...list.querySelectorAll("[data-work-index]")].find((row) => {
      const rect = row.getBoundingClientRect();
      return (
        rect.top > scroller.getBoundingClientRect().top &&
        rect.bottom < scroller.getBoundingClientRect().bottom
      );
    });
  await until(visibleRow, "No visible work row");
  const text = visibleRow();
  expect(text, "No visible work row");
  const selection = getSelection();
  const range = document.createRange();
  range.selectNodeContents(text);
  selection.removeAllRanges();
  selection.addRange(range);
  await new Promise(requestAnimationFrame);
  const selectedText = selection.toString();
  expect(selectedText.length > 0, "Selection is empty");
  scroller.scrollTop += scroller.clientHeight * 4;
  await new Promise((resolve) => setTimeout(resolve, 250));
  expect(
    text.isConnected && selection.toString() === selectedText,
    "Scrolling discarded selected text",
  );
  selection.removeAllRanges();
  await until(() => !text.isConnected, "Cleared selection retained offscreen work");
  const mounted = list.querySelectorAll("[data-work-index]").length;
  expect(mounted < 80, "Scrolled work DOM is not bounded");
  document.querySelector('[data-testid="v4-timeline-bottom"]')?.click();
  await until(
    () => scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 5,
    "Bottom did not settle",
  );
  const turnId = document
    .querySelector("[data-v4-running-live-tail] section[data-turn-id]")
    .dataset.turnId.replace("turn-", "");
  const query = `Work ${turnId}/4500`;
  setQuery(query);
  await until(
    () => document.querySelector('[data-testid="matches"]').textContent === "1",
    "Offscreen search lost model content",
  );
  await until(() => {
    const highlights = CSS.highlights.get("zcode-v4-conversation-find-active");
    const match = highlights && [...highlights][0];
    if (!match || !match.toString().includes(query)) return false;
    const rect = match.getBoundingClientRect();
    return (
      rect.top >= scroller.getBoundingClientRect().top &&
      rect.bottom <= scroller.getBoundingClientRect().bottom
    );
  }, "Offscreen search failed to mount, highlight and align target");
  setQuery("");
  return {
    count,
    mounted,
    selection: true,
    bottom: true,
    offscreenSearch: true,
    viewport: [innerWidth, innerHeight],
  };
})();
