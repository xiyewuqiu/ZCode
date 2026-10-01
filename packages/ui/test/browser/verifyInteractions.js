(async () => {
  const expect = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  const until = async (predicate, message) => {
    const deadline = performance.now() + 15000;
    while (!predicate()) {
      expect(performance.now() < deadline, message);
      await new Promise(requestAnimationFrame);
    }
  };
  const input = (element, value) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const scroller = document.querySelector('[data-v4-timeline-scroll="true"]');
  expect(scroller, "Timeline missing");
  const find = document.querySelector('[data-testid="find"]');
  input(find, "unique-query-0");
  await until(
    () => document.querySelector('[data-testid="matches"]').textContent === "1",
    "Find did not update",
  );
  await until(
    () => document.querySelector('[data-turn-id="turn-0"]'),
    "Find did not mount early turn",
  );
  const firstTurn = document.querySelector('section[data-turn-id="turn-0"]');
  const toggle = firstTurn.querySelector('[data-testid^="chat-assistant-history-trigger"]');
  expect(
    toggle?.getAttribute("aria-expanded") === "false",
    "Completed history should start collapsed",
  );
  toggle.click();
  await until(() => firstTurn.querySelector('[data-row-id="3"]'), "History failed to expand");
  expect(firstTurn.textContent.includes("Work 0/0"), "Expanded history lost its body");
  toggle.click();
  await until(() => toggle.getAttribute("aria-expanded") === "false", "History failed to collapse");
  input(find, "");
  await until(
    () => document.querySelector('[data-testid="matches"]').textContent === "0",
    "Find failed to clear",
  );
  const stream = document.querySelector('[data-testid="stream"]');
  stream.click();
  const typing = document.querySelector('[data-testid="typing"]');
  input(typing, "Typing during a long stream");
  await new Promise(requestAnimationFrame);
  expect(typing.value === "Typing during a long stream", "Input was lost during streaming");
  stream.click();
  document.querySelector('[data-testid="v4-timeline-bottom"]')?.click();
  await until(
    () => scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 5,
    "Back to bottom did not settle",
  );
  expect(
    document.querySelectorAll("[data-v4-turn-unit]").length < 40,
    "History virtualization mounted too many turns",
  );
  const live = document.querySelector("[data-v4-running-live-tail]");
  const finalTurnId = live?.querySelector("section[data-turn-id]")?.dataset.turnId;
  expect(live?.textContent.includes("Work"), "Live work items missing");
  const totalRows = Number(scroller.dataset.rowCount);
  document.querySelector('[data-testid="complete"]').click();
  await until(
    () => !document.querySelector("[data-v4-running-live-tail]"),
    "Completed turn remained in live tail",
  );
  expect(Number(scroller.dataset.rowCount) === totalRows, "Completion discarded history");
  const finalTurn = document.querySelector(`section[data-turn-id="${finalTurnId}"]`);
  const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator.clipboard, "writeText");
  let copiedText;
  try {
    Object.defineProperty(navigator.clipboard, "writeText", {
      configurable: true,
      value: async (text) => {
        copiedText = text;
      },
    });
    const copy = [...finalTurn.querySelectorAll('[data-testid^="v4-copy-"]')].at(-1);
    expect(copy, "Assistant copy action missing");
    copy.click();
    await until(() => typeof copiedText === "string", "Copy did not reach clipboard adapter");
    const turnNumber = finalTurnId.replace("turn-", "");
    expect(copiedText.includes(`Work ${turnNumber}/0`), "Copy lost unmounted early work");
    expect(copiedText.includes(`Answer ${turnNumber}`), "Copy lost final reply");
  } finally {
    if (clipboardDescriptor)
      Object.defineProperty(navigator.clipboard, "writeText", clipboardDescriptor);
    else delete navigator.clipboard.writeText;
  }
  return {
    search: true,
    expandCollapse: true,
    typing: true,
    backToBottom: true,
    completion: true,
    fullModelCopy: true,
    totalRows,
    viewport: [innerWidth, innerHeight],
  };
})();
