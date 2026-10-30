// 完整视图内容区的焦点陷阱与 Escape 退出（spec：specs/conversation/side-pane-full-view.md）。
// 只操作 DOM 焦点，不持有业务状态；容器由壳层提供，覆盖对话宿主与面板内容。
import { useEffect, type RefObject } from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[contenteditable='true']",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function readFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) =>
      element.getAttribute("aria-hidden") !== "true" &&
      !element.hasAttribute("disabled") &&
      element.getClientRects().length > 0,
  );
}

export function useSidePaneFullViewFocusTrap({
  active,
  containerRef,
  onExit,
  restoreFocusRef,
}: {
  active: boolean;
  containerRef: RefObject<HTMLElement | null>;
  onExit: () => void;
  /** 退出时优先返回的按钮（进入前的焦点不可用时使用）。 */
  restoreFocusRef?: RefObject<HTMLElement | null>;
}) {
  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!container.contains(document.activeElement)) {
      readFocusableElements(container)[0]?.focus();
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onExit();
        return;
      }
      if (event.key !== "Tab") return;
      const focusables = readFocusableElements(container);
      if (focusables.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      const current = document.activeElement;
      if (!(current instanceof HTMLElement) || !container.contains(current)) {
        event.preventDefault();
        first.focus();
        return;
      }
      if (event.shiftKey && current === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && current === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      // 退出后回到进入前的焦点；元素已被卸载时退回切换按钮。
      window.requestAnimationFrame(() => {
        const target =
          previouslyFocused?.isConnected === true ? previouslyFocused : restoreFocusRef?.current;
        target?.focus();
      });
    };
  }, [active, containerRef, onExit, restoreFocusRef]);
}
