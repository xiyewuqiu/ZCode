import { useEffect, type RefObject } from "react";
import { resolveConversationShareScrollbarIndicatorMetrics } from "@/v4/conversationShareScrollbarMetrics.js";

export function useConversationShareScrollbar(
  shellRef: RefObject<HTMLDivElement | null>,
  thumbRef: RefObject<HTMLDivElement | null>,
) {
  useEffect(() => {
    const shell = shellRef.current;
    const thumb = thumbRef.current;
    const viewport = shell?.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]');
    if (!shell || !thumb || !viewport) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const metrics = resolveConversationShareScrollbarIndicatorMetrics({
        trackSize: shell.clientHeight,
        viewportSize: viewport.clientHeight,
        contentSize: viewport.scrollHeight,
        scrollOffset: viewport.scrollTop,
      });
      thumb.style.display = metrics.visible ? "block" : "none";
      thumb.style.height = `${metrics.size}px`;
      thumb.style.transform = `translateY(${metrics.offset}px)`;
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    viewport.addEventListener("scroll", schedule, { passive: true });
    const observer = new ResizeObserver(schedule);
    observer.observe(shell);
    observer.observe(viewport);
    if (viewport.firstElementChild) observer.observe(viewport.firstElementChild);
    schedule();
    return () => {
      viewport.removeEventListener("scroll", schedule);
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [shellRef, thumbRef]);
}
