(async () => {
  const assert = (condition, label) => {
    if (!condition) throw new Error(label);
  };
  const find = (id) => document.querySelector(`[data-testid="${id}"]`);
  const rows = () => document.querySelectorAll('[data-conversation-share-selection-item="true"]');
  const settle = () =>
    new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const key = async (value) => {
    document.activeElement.dispatchEvent(
      new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true }),
    );
    await settle();
  };
  const search = async (value) => {
    const input = find("conversation-share-search");
    input.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await settle();
  };
  await settle();
  assert(rows().length > 0 && rows().length <= 32, `Unbounded candidate DOM: ${rows().length}`);
  const initialMounted = rows().length;
  await search("");
  await key("ArrowDown");
  assert(
    document.activeElement.dataset.candidateFocus === "query-0",
    "Search cannot enter results",
  );
  find("conversation-share-search").focus();
  await key("ArrowDown");
  assert(
    document.activeElement.dataset.candidateFocus === "query-0",
    "Cannot refocus the same result",
  );
  await key("End");
  assert(
    document.activeElement.dataset.candidateFocus === "query-1998",
    "End lost focus or selected running turn",
  );
  await key(" ");
  await key("Enter");
  assert(find("selected").textContent === "1998", "Space did not toggle exactly once");
  assert(find("inspected").textContent === "1998", "Enter did not inspect the focused query");
  await key("Home");
  for (let i = 0; i < 35; i++) await key("ArrowDown");
  assert(
    document.activeElement.dataset.candidateFocus === "query-35",
    "Arrow navigation failed across virtual windows",
  );
  await search("QUESTION 1500");
  assert(rows().length === 1, "Case-insensitive search did not filter");
  await key("ArrowDown");
  await key(" ");
  assert(find("selected").textContent === "1500,1998", "Filtering discarded hidden selections");
  await search("Question 1999");
  assert(
    document.querySelector('[data-candidate-focus="query-1999"]').disabled,
    "Running query became enabled",
  );
  await search("no-such-preview");
  assert(
    rows().length === 0 && document.body.textContent.includes("No matching previews"),
    "Missing no-results state",
  );
  find("conversation-share-search-clear").click();
  await settle();
  assert(
    rows().length > 0 && rows().length <= 32,
    "Clearing search did not restore a bounded list",
  );
  find("finish").click();
  await settle();
  await search("");
  await key("ArrowUp");
  assert(
    document.activeElement.dataset.candidateFocus === "query-1999",
    "Completed turn did not become navigable",
  );
  const panel = find("conversation-share-selection-panel").getBoundingClientRect();
  assert(
    panel.left >= 0 && panel.right <= innerWidth && panel.bottom <= innerHeight,
    "Panel exceeds viewport",
  );
  const maximumMounted = rows().length;
  find("narrow").click();
  await settle();
  const narrowPanel = find("conversation-share-selection-panel").getBoundingClientRect();
  const container = find("share-container").getBoundingClientRect();
  assert(
    narrowPanel.left >= container.left && narrowPanel.right <= container.right,
    "Panel overflows a narrow split pane",
  );
  find("visibility").click();
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert(!find("conversation-share-selection-panel"), "Closed panel stayed mounted");
  find("visibility").click();
  await settle();
  assert(find("conversation-share-search").value === "", "Reopened panel retained stale search");
  return {
    passed: true,
    candidates: 2000,
    initialMounted,
    maximumMounted,
    viewport: [innerWidth, innerHeight],
    reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
  };
})();
