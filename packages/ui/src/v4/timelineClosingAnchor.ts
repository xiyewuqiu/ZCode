// 虚拟滚动核心：贴底阅读时的「上方收起保持锚点」纯逻辑（无 DOM/React 依赖）。
//
// 语义（keepAboveClosing）：
// - 用户贴底阅读时，轮次完成会一次性收起工作历史、live tail 迁移进虚拟列表，
//   或 virtualizer 修正测高。这些动作让内容在视口上方变短，浏览器的自然结果是
//   scrollTop 被钳回、正文整体下滑，阅读位置突然跳走。
// - 正确做法不是继续「钉死底部」，而是在下方补一段空白（spacer），把正文停在
//   原屏幕位置，再让空白充当临时滚动余量。空白最多占半个视口，超过后内容尾部
//   停在视口中线，避免把最后一条消息顶到看不见的位置。
// - 空白只由显式重置（回到底部 / 恢复 / 跳转 / 解锁 / 宽度变化 / 行清空）或
//   内容增长填满时收回；不进入 React 状态，也不改变 totalSize/scrollMargin。

/** 判定内容「变短」的容差：亚像素布局差异不算收起。 */
const CONTENT_SHRINK_EPSILON_PX = 0.5;

/** 底部括号预留的上限：超过半个视口会把内容尾部顶出阅读区。 */
const MAX_SPACER_VIEWPORT_RATIO = 0.5;

/** 视口内可参与锚定的顶层单元（content 坐标 = 滚动内容顶部为 0）。 */
export interface TimelineClosingAnchorUnit {
  /** render unit key（turn key），跨 live tail 迁移保持稳定。 */
  key: string;
  top: number;
  bottom: number;
}

/** 一个基准锚点：单元顶部到当时内容末尾的距离。 */
export interface TimelineClosingAnchorRef {
  key: string;
  fromEnd: number;
}

/** 收起前捕获的阅读基准；只在贴底且空闲时生成。 */
export interface TimelineClosingAnchorBaseline {
  /** 不含 spacer 的内容高度。 */
  contentHeight: number;
  /** 按 DOM 顺序排列的候选锚点：首个可见行、其后屏幕内行、再往前一屏内行。 */
  anchors: readonly TimelineClosingAnchorRef[];
  capturedAt: number;
}

/** 收起后的处理结论。 */
export type TimelineClosingAnchorPlan =
  | { kind: "hold" }
  | { kind: "grow" }
  | { kind: "lost" }
  | { kind: "apply"; scrollTop: number; spacerHeight: number };

function isFiniteNumber(value: number): boolean {
  return Number.isFinite(value);
}

function unitHeight(unit: TimelineClosingAnchorUnit): number {
  return unit.bottom - unit.top;
}

/**
 * 捕获首个可见行及其前后一屏内的行。
 *
 * `fromEnd` 以「捕获时视口底部所在的内容坐标」为基准，而不是内容末尾：
 * 贴底判定允许几十像素容差，若用内容末尾换算，收起后会额外上移这段距离。
 * 用绘制时的视口底部可精确保持行的屏幕位置。
 *
 * 顺序即回退顺序：首个可见行优先，其次它下方仍在屏幕内的行（视觉焦点），
 * 最后向上寻找最近的存活行。首行无法确定时返回 null，宁可不锚定也不猜。
 */
export function captureTimelineClosingBaseline(input: {
  units: readonly TimelineClosingAnchorUnit[];
  contentHeight: number;
  viewportHeight: number;
  scrollTop: number;
  capturedAt?: number;
}): TimelineClosingAnchorBaseline | null {
  const { units, contentHeight, viewportHeight, scrollTop } = input;
  if (
    !isFiniteNumber(contentHeight) ||
    !isFiniteNumber(viewportHeight) ||
    !isFiniteNumber(scrollTop) ||
    viewportHeight <= 0
  ) {
    return null;
  }
  const viewportTop = scrollTop;
  const viewportBottom = scrollTop + viewportHeight;
  let firstVisible = -1;
  for (let index = 0; index < units.length; index += 1) {
    const unit = units[index]!;
    if (unitHeight(unit) <= 0) continue;
    if (unit.bottom <= viewportTop || unit.top >= viewportBottom) continue;
    firstVisible = index;
    break;
  }
  if (firstVisible < 0) return null;

  const anchors: TimelineClosingAnchorRef[] = [];
  const add = (unit: TimelineClosingAnchorUnit) => {
    if (unitHeight(unit) <= 0) return;
    anchors.push({ key: unit.key, fromEnd: viewportBottom - unit.top });
  };

  add(units[firstVisible]!);
  for (let index = firstVisible + 1; index < units.length; index += 1) {
    const unit = units[index]!;
    if (unit.top >= viewportBottom) break;
    add(unit);
  }
  for (let index = firstVisible - 1; index >= 0; index -= 1) {
    const unit = units[index]!;
    if (unit.bottom <= viewportTop - viewportHeight) break;
    add(unit);
  }

  return { contentHeight, anchors, capturedAt: input.capturedAt ?? Date.now() };
}

/**
 * 收起后根据存活锚点计算 spacer 与目标 scrollTop。
 *
 * - `hold`：内容高度尚未变化（收起动画还没走完），保留基准继续等；
 * - `grow`：内容反而增长，旧基准的屏幕坐标已失效，应丢弃并恢复常规贴底；
 * - `lost`：内容变短但所有候选行都已卸载，无法可靠锚定；
 * - `apply`：内容仍在，把其屏幕位置固定下来，缺口由下方 spacer 补齐。
 */
export function planTimelineClosingAnchor(input: {
  baseline: TimelineClosingAnchorBaseline;
  surviving: ReadonlyMap<string, { top: number; height: number }>;
  contentHeight: number;
  viewportHeight: number;
  maxRoomRatio?: number;
}): TimelineClosingAnchorPlan {
  const { baseline, surviving, contentHeight, viewportHeight } = input;
  if (!isFiniteNumber(contentHeight) || !isFiniteNumber(viewportHeight) || viewportHeight <= 0) {
    return { kind: "lost" };
  }
  if (contentHeight > baseline.contentHeight + CONTENT_SHRINK_EPSILON_PX) {
    return { kind: "grow" };
  }
  if (contentHeight >= baseline.contentHeight - CONTENT_SHRINK_EPSILON_PX) {
    return { kind: "hold" };
  }

  let targetTop: number | null = null;
  for (const anchor of baseline.anchors) {
    const current = surviving.get(anchor.key);
    if (!current || current.height <= 0) continue;
    // fromEnd 是「行顶部到绘制时视口底部」的距离；把它换算成当前 scrollTop，
    // 行的屏幕位置就与收起前完全一致，与贴底容差无关。
    targetTop = current.top - (viewportHeight - anchor.fromEnd);
    break;
  }
  if (targetTop === null) return { kind: "lost" };

  const cap = Math.max(0, viewportHeight * (input.maxRoomRatio ?? MAX_SPACER_VIEWPORT_RATIO));
  if (targetTop + viewportHeight - contentHeight > cap) {
    targetTop = contentHeight + cap - viewportHeight;
  }
  const scrollTop = Math.max(0, targetTop);
  const spacerHeight = Math.max(0, Math.ceil(scrollTop + viewportHeight - contentHeight));
  return { kind: "apply", scrollTop, spacerHeight };
}

/**
 * 内容增长时用新增高度抵扣 spacer，避免读到底部后又被空白挡住。
 * `growth` 只取非负值；内容再次变短由收起基准处理，不能反向撑大空白。
 */
export function reclaimTimelineClosingSpacer(input: {
  spacerHeight: number;
  contentHeight: number;
  scrollTop: number;
  viewportHeight: number;
  contentGrowth: number;
}): { spacerHeight: number; reachedContentBottom: boolean } {
  const growth = Math.max(0, isFiniteNumber(input.contentGrowth) ? input.contentGrowth : 0);
  return {
    spacerHeight: Math.max(0, input.spacerHeight - growth),
    reachedContentBottom:
      input.scrollTop + input.viewportHeight >= input.contentHeight - CONTENT_SHRINK_EPSILON_PX,
  };
}

/** 是否具备捕获阅读基准的条件：贴底、空闲、未跳转、未处于宽度重排。 */
export function shouldCaptureTimelineClosingBaseline(input: {
  following: boolean;
  jumping: boolean;
  animating: boolean;
  contentWidthChanging: boolean;
  userIntent: "none" | "awayFromBottom" | "towardBottom" | "unknown";
}): boolean {
  return (
    input.following &&
    !input.jumping &&
    !input.animating &&
    !input.contentWidthChanging &&
    input.userIntent !== "awayFromBottom"
  );
}

/** 基准只在短时间内有效；过期后宁可放弃锚定，也不拿陈旧几何改写滚动位置。 */
export function isTimelineClosingBaselineFresh(
  baseline: TimelineClosingAnchorBaseline | null,
  nowMs: number,
  ttlMs: number,
): boolean {
  return baseline !== null && nowMs - baseline.capturedAt <= ttlMs;
}
