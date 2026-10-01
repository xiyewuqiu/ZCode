(async () => {
  const assert = (value, message) => {
    if (!value) throw new Error(message);
  };
  const find = (id) => document.querySelector(`[data-testid="${id}"]`);
  const settle = () =>
    new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const click = async (id) => {
    assert(find(id), `Missing ${id}`);
    find(id).click();
    await settle();
  };
  const counters = window.shellCounters;
  assert(counters.rowReads === 0, "Dormant share projection read history");
  const subscribed = counters.subscribes;
  for (let i = 0; i < 20; i++) await click("emit");
  assert(find("revision").textContent === "20", "Store updates were dropped");
  assert(counters.subscribes === subscribed, "Streaming re-subscribed the same store");
  await click("row-update");
  assert(counters.rowReads === 0, "Dormant streaming built share rows");
  await click("share");
  assert(find("candidates").textContent === "Updated", "Share did not read latest rows");
  await click("scope");
  assert(find("candidates").textContent === "Other workspace", "Scope reused old candidates");
  await click("share");
  const reads = counters.rowReads;
  await click("row-update");
  assert(counters.rowReads === reads, "Closing sharing retained active projection");
  const unsubscribed = counters.unsubscribes;
  await click("store");
  assert(counters.unsubscribes === unsubscribed + 1, "Old store was not released");
  assert(find("revision").textContent === "0", "Store switch showed stale data");
  await click("unmount");
  assert(counters.unsubscribes === unsubscribed + 2, "Unmount leaked subscription");
  assert(!find("desktop-window-controls"), "Duplicate native and custom controls");
  await click("zoom");
  assert(
    find("native-window-controls-spacer").getBoundingClientRect().width === 84,
    "Native caption safety area ignored zoom",
  );
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  await click("panel");
  if (reduced)
    assert(
      !find("animated-panel").className.includes("transition-[flex-grow]"),
      "Reduced motion still animates panel layout",
    );
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert(find("animated-panel").getBoundingClientRect().width > 50, "Panel did not expand");
  await click("panel");
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert(find("animated-panel").getBoundingClientRect().width < 1, "Panel did not collapse");
  await click("loading");
  assert(find("settings-page-loading"), "Missing settings loading shell");
  assert(find("native-window-controls-spacer"), "Settings loading lost window controls");
  assert(document.documentElement.scrollWidth <= innerWidth, "Loading shell overflows viewport");
  await click("settings-loading-back");
  assert(!find("settings-page-loading"), "Loading shell back navigation failed");
  return {
    passed: true,
    reducedMotion: reduced,
    counters: { ...counters },
    viewport: [innerWidth, innerHeight],
  };
})();
