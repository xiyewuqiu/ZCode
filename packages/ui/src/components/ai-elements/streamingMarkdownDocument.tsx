/**
 * 流式 Markdown 的冻结前缀渲染容器。
 *
 * 解析器把累计文本切成冻结块、尾部源文本和未闭合围栏；本模块只负责把
 * 冻结块缓存为 React 元素（key 为绝对源 offset），每个 chunk 仅重新生成
 * 尾部元素。元素对象保持同一引用，React 会跳过冻结块的重新渲染。
 */

import type { ReactElement, ReactNode } from "react";
import { useMemo } from "react";
import {
  IncrementalMarkdownParser,
  type FrozenMarkdownBlock,
  type OpenMarkdownFence,
} from "@/lib/incrementalMarkdown.js";

export type StreamingMarkdownRenderMode = "static" | "streaming";

/** 由消息渲染层提供的稳定回调；identity 变化时必须重建。 */
export interface StreamingMarkdownRenderers {
  /** 渲染一段 Markdown 源文本；`key` 必须随源区域的绝对位置保持稳定。 */
  renderChunk: (source: string, mode: StreamingMarkdownRenderMode, key: string) => ReactElement;
  /** 渲染尾部未闭合代码围栏；key 使用围栏起始 offset。 */
  renderOpenFence: (fence: OpenMarkdownFence) => ReactElement;
}

interface StreamingMarkdownDocumentQueueOptions {
  readonly renderers: StreamingMarkdownRenderers;
}

class StreamingMarkdownDocumentQueue {
  private readonly parser = new IncrementalMarkdownParser();
  private generation = -1;
  private frozenElements: ReactElement[] = [];
  private frozenCount = 0;
  private lastMarkdown: string | null = null;
  private lastNodes: ReactNode[] = [];

  constructor(private readonly options: StreamingMarkdownDocumentQueueOptions) {}

  private frozenElement(block: FrozenMarkdownBlock): ReactElement {
    return this.options.renderers.renderChunk(block.source, "static", `frozen-${block.key}`);
  }

  render(markdown: string): ReactNode[] {
    if (markdown === this.lastMarkdown) return this.lastNodes;
    const snapshot = this.parser.update(markdown);
    if (snapshot.generation !== this.generation) {
      this.generation = snapshot.generation;
      this.frozenElements = [];
      this.frozenCount = 0;
    }
    for (const block of snapshot.frozen.slice(this.frozenCount)) {
      this.frozenElements.push(this.frozenElement(block));
      this.frozenCount += 1;
    }
    const nodes: ReactNode[] = [...this.frozenElements];
    if (snapshot.openFence !== null) {
      if (snapshot.tailSource.trim().length > 0) {
        nodes.push(
          this.options.renderers.renderChunk(snapshot.tailSource, "streaming", "streaming-tail"),
        );
      }
      nodes.push(this.options.renderers.renderOpenFence(snapshot.openFence));
    } else if (snapshot.tailSource.length > 0) {
      nodes.push(
        this.options.renderers.renderChunk(snapshot.tailSource, "streaming", "streaming-tail"),
      );
    }
    this.lastMarkdown = markdown;
    this.lastNodes = nodes;
    return nodes;
  }
}

export interface StreamingMarkdownDocumentProps {
  /** 完整累计 Markdown 源文本；完成态不要使用本组件。 */
  markdown: string;
  /**
   * 渲染身份（主题、代码设置、workspace、reader 等）；变化时整体丢弃冻结元素，
   * 避免缓存闭包保留旧主题或旧上下文。
   */
  identity: string;
  className?: string;
  renderers: StreamingMarkdownRenderers;
}

/**
 * 渲染流式 Markdown：冻结块复用缓存元素，只有尾部按 chunk 重新渲染。
 */
export function StreamingMarkdownDocument({
  markdown,
  identity,
  className,
  renderers,
}: StreamingMarkdownDocumentProps) {
  // identity 不参与渲染逻辑，只作为缓存失效信号；变化时重建队列。
  const queue = useMemo(
    () => new StreamingMarkdownDocumentQueue({ renderers }),
    [identity, renderers],
  );
  const nodes = useMemo(() => queue.render(markdown), [markdown, queue]);
  return <div className={className}>{nodes}</div>;
}
