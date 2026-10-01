(async () => {
  const scroller = document.querySelector('[data-v4-timeline-scroll="true"]');
  if (!scroller) throw new Error("Timeline did not mount");
  const stream = document.querySelector('[data-testid="stream"]');
  stream.click();
  const samples = [];
  let previous = performance.now();
  for (let frame = 0; frame < 180; frame++) {
    await new Promise(requestAnimationFrame);
    const now = performance.now();
    if (frame > 15) samples.push(now - previous);
    previous = now;
    scroller.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, bubbles: true }));
    scroller.scrollTop = Math.max(
      0,
      scroller.scrollHeight - scroller.clientHeight - 6000 + Math.sin(frame / 12) * 4000,
    );
  }
  stream.click();
  samples.sort((a, b) => a - b);
  return {
    frames: samples.length,
    frameMedianMs: samples[Math.floor(samples.length * 0.5)],
    frameP95Ms: samples[Math.floor(samples.length * 0.95)],
    frameMaxMs: samples.at(-1),
    framesOver50Ms: samples.filter((sample) => sample > 50).length,
    mountedTurns: document.querySelectorAll("[data-v4-turn-unit]").length,
    mountedRows: document.querySelectorAll("[data-row-id]").length,
    totalRows: Number(scroller.dataset.rowCount),
    scrollHeight: scroller.scrollHeight,
  };
})();
