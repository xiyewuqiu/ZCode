// 直接复用真实常量；测试不模拟产品逻辑，也不加载与队列无关的服务端协议。
export * from "../../../shared/src/test-ids.js";
export { DEFAULT_LOCALE } from "../../../shared/src/protocol.js";
export { formatLogPrefix } from "../../../shared/src/log-format.js";
