import { createContext, memo, useContext, useLayoutEffect, useRef, type ReactNode } from "react";
import { cn } from "@/components/lib/utils.js";

/**
 * 层活动门控：隐藏层与流式渲染的边界。
 *
 * 设置页覆盖工作区、主视图在 chat/automations/plugin-store 之间切换时，过去只有两条路：
 * 整树卸载重建（丢状态、重订阅、重测高），或者让隐藏界面继续跟着流式输出重渲染。
 * 这里给出第三条路：DOM 与订阅都保留（恢复零成本），但隐藏层不接收新的 React 通知，
 * 重新激活时用一次提交读到最新状态。
 *
 * 与 `document.visibilityState` 的处理同源（见 visibleProjectionSubscription）：
 * 事实继续写入 store，只是按帧推迟渲染。布局语义不变，未激活层用
 * `invisible`（保留布局，动态测高不会归零）而不是 `display:none`。
 */

export interface LayerActivity {
  isActive(): boolean;
  /** 订阅活动态变化；激活时触发（供挂起的消费者补一次渲染）。 */
  subscribe(listener: () => void): () => void;
}

const ALWAYS_ACTIVE: LayerActivity = {
  isActive: () => true,
  subscribe: () => () => {},
};

export interface LayerActivityController extends LayerActivity {
  setActive(active: boolean): void;
}

export function createLayerActivityController(initialActive: boolean): LayerActivityController {
  let active = initialActive;
  const listeners = new Set<() => void>();
  return {
    isActive: () => active,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setActive(next) {
      if (next === active) return;
      active = next;
      if (!next) return;
      // Set 迭代期间删除自身是安全语义；激活通知只做「补一次渲染」。
      for (const listener of listeners) listener();
    },
  };
}

/** 宿主层持有门控：active 变化在绘制前同步到订阅者。 */
export function useLayerActivityController(active: boolean): LayerActivityController {
  const controllerRef = useRef<LayerActivityController | null>(null);
  if (controllerRef.current === null) {
    controllerRef.current = createLayerActivityController(active);
  }
  const controller = controllerRef.current;
  useLayoutEffect(() => {
    controller.setActive(active);
  }, [active, controller]);
  return controller;
}

const LayerActivityContext = createContext<LayerActivity>(ALWAYS_ACTIVE);

export const LayerActivityProvider = LayerActivityContext.Provider;

/** 最近的层活动门控；没有宿主层时视为始终活动。 */
export function useLayerActivity(): LayerActivity {
  return useContext(LayerActivityContext);
}

/** 没有宿主 provider 时用于测试/工具场景的常量门控。 */
export const alwaysActiveLayerActivity = ALWAYS_ACTIVE;

interface LayerSurfaceProps {
  active: boolean;
  className?: string;
  children: ReactNode;
  testId?: string;
}

/**
 * 常驻层容器：非活动层保留 DOM 与布局（动态测高不归零），只关闭可见性、命中与
 * React 通知。宿主必须在自身容器上提供定位上下文。
 */
export const LayerSurface = memo(function LayerSurface({
  active,
  className,
  children,
  testId,
}: LayerSurfaceProps) {
  const controller = useLayerActivityController(active);
  return (
    <LayerActivityProvider value={controller}>
      <div
        data-testid={testId}
        data-layer-active={active ? "true" : "false"}
        className={cn(
          "h-full",
          !active && "pointer-events-none invisible absolute inset-0",
          className,
        )}
        aria-hidden={active ? undefined : true}
        inert={active ? undefined : true}
      >
        {children}
      </div>
    </LayerActivityProvider>
  );
});
