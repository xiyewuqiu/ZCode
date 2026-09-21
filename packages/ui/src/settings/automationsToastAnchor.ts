/**
 * Automations 主视图的 toast 锚点 id。
 *
 * 单独成文件：workspace shell 需要这个常量来挂锚点，但不应因此静态引入整个
 * AutomationsSection（首屏只需 id，页面本体按需加载）。
 */
export const AUTOMATIONS_TOAST_ANCHOR_ID = "automations-main-toast-anchor";
