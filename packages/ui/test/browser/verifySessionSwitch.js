(async () => {
  const frame = () => new Promise(requestAnimationFrame);
  const scroller = () => document.querySelector('[data-v4-timeline-scroll="true"]');
  const count = scroller().dataset.rowCount;
  document.querySelector('[data-testid="stream"]').click();
  const switcher = document.querySelector('[data-testid="switch-session"]');
  const samples = [];
  for (let i = 0; i < 5; i++) {
    const start = performance.now();
    switcher.click();
    await frame();
    await frame();
    if (scroller().dataset.rowCount !== "6")
      throw new Error("Session switch retained old projection");
    if (document.querySelector("[data-work-window]"))
      throw new Error("Inactive session retained work DOM");
    await new Promise((resolve) => setTimeout(resolve, 110));
    switcher.click();
    await frame();
    await frame();
    if (scroller().dataset.rowCount !== count) throw new Error("Returning lost long history");
    samples.push(performance.now() - start - 110);
  }
  document.querySelector('[data-testid="stream"]').click();
  if (!scroller().textContent.includes("token"))
    throw new Error("Background stream did not catch up");
  return { switches: 10, retainedBackgroundUpdates: true, roundTripMs: samples };
})();
